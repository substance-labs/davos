import threading
import time
import datetime
from flask import Flask, request, jsonify
import requests

from proposal_analyzer import analyze_proposals

app = Flask(__name__)

# Global in-memory cache with TTL of 5 minutes (300 seconds)
cache = {}
TTL = 300  # seconds

def update_cache(key, params):
    """Update cache entry for key by calling analyze_proposals with given parameters."""
    try:
        result = analyze_proposals(**params)
        cache[key] = {"result": result, "timestamp": time.time(), "params": params}
    except Exception as e:
        print("Error updating cache in background:", e)

def get_cached_response(key, params, skip_cache):
    """Returns cached result if available and valid; otherwise calls analyze_proposals and updates cache."""
    current_time = time.time()
    if skip_cache or key not in cache:
        result = analyze_proposals(**params)
        cache[key] = {"result": result, "timestamp": current_time, "params": params}
        return result
    entry = cache[key]
    age = current_time - entry["timestamp"]
    if age > TTL:
        # Cache expired: update synchronously.
        result = analyze_proposals(**params)
        cache[key] = {"result": result, "timestamp": current_time, "params": params}
        return result
    else:
        # Return cached result.
        return entry["result"]

def background_cache_refresher():
    """Periodically checks cache entries and updates those nearing expiration."""
    while True:
        current_time = time.time()
        for key, entry in list(cache.items()):
            age = current_time - entry["timestamp"]
            # If less than 60 seconds remain in TTL, update in background.
            if TTL - age < 60:
                threading.Thread(target=update_cache, args=(key, entry["params"]), daemon=True).start()
        time.sleep(30)  # Check every 30 seconds.

@app.after_request
def add_cors_headers(response):
    """Add permissive CORS headers to all responses."""
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Requested-With"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return response

@app.route("/api/proposals", methods=["GET", "OPTIONS"])
def proposals_api():
    # Required parameters: source and identifier.
    source = request.args.get("source", "").lower()
    if source not in ["snapshot", "tally"]:
        return jsonify({"error": "Missing or invalid 'source'. Must be 'snapshot' or 'tally'."}), 400
    identifier = request.args.get("identifier", "")
    if not identifier:
        return jsonify({"error": "Missing 'identifier' parameter."}), 400

    # Optional date parameters; default to last 90 days if not provided.
    today = datetime.date.today()
    default_end = today.strftime("%d/%m/%Y")
    default_start = (today - datetime.timedelta(days=90)).strftime("%d/%m/%Y")
    start_date = request.args.get("start_date", default_start)
    end_date = request.args.get("end_date", default_end)

    # Optional flags.
    identify_mimetypes = request.args.get("identify_mimetypes", "false").lower() in ["true", "1"]
    exclude_discourse = request.args.get("exclude_discourse", "false").lower() in ["true", "1"]
    skip_cache = request.args.get("skip_cache", "false").lower() in ["true", "1"]

    # Build parameters dictionary for analyze_proposals.
    params = {
        "source": source,
        "identifier": identifier,
        "start_date": start_date,
        "end_date": end_date,
        "identify_mimetypes": identify_mimetypes,
        "exclude_discourse": exclude_discourse
    }

    # Create a cache key based on the parameters.
    key = (source, identifier, start_date, end_date, identify_mimetypes, exclude_discourse)
    try:
        result = get_cached_response(key, params, skip_cache)
    except Exception as e:
        return jsonify({"error": f"Error processing request: {str(e)}"}), 500

    return jsonify(result)

@app.route("/tally", methods=["POST", "OPTIONS"])
def tally_proxy():
    """Proxy endpoint for Tally GraphQL queries to avoid CORS issues."""
    if request.method == "OPTIONS":
        return "", 200
    
    try:
        # Get the GraphQL query and variables from the request
        data = request.get_json()
        if not data:
            return jsonify({"error": "Request body must be JSON"}), 400
        
        query = data.get("query")
        variables = data.get("variables", {})
        
        if not query:
            return jsonify({"error": "Missing 'query' field"}), 400
        
        # Get Tally API key from environment
        import os
        tally_api_key = os.environ.get("TALLY_API_KEY")
        if not tally_api_key:
            return jsonify({"error": "Tally API key not configured"}), 500
        
        # Forward the request to Tally API
        tally_url = "https://api.tally.xyz/query"
        headers = {
            "Content-Type": "application/json",
            "Api-Key": tally_api_key,
        }
        
        response = requests.post(
            tally_url,
            json={"query": query, "variables": variables},
            headers=headers,
            timeout=10
        )
        
        # Return the Tally response
        return response.json(), response.status_code
    
    except requests.exceptions.Timeout:
        return jsonify({"error": "Tally API request timed out"}), 504
    except requests.exceptions.RequestException as e:
        return jsonify({"error": f"Error contacting Tally API: {str(e)}"}), 503
    except Exception as e:
        return jsonify({"error": f"Error processing request: {str(e)}"}), 500

if __name__ == "__main__":
    # Start background cache refresher thread.
    threading.Thread(target=background_cache_refresher, daemon=True).start()
    # For local testing; in production, run under uWSGI.
    app.run(host="0.0.0.0", port=6000)

