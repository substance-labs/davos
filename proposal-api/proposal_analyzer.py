import argparse
import datetime
import json
import re
import statistics
import time
from html import unescape
from urllib.parse import urlparse
import requests

# ----------------------
# Utility Functions
# ----------------------

def convert_date_to_epoch(date_str):
    """Converts a date string (dd/mm/yyyy) to an epoch timestamp (seconds)."""
    dt = datetime.datetime.strptime(date_str, "%d/%m/%Y")
    return int(dt.timestamp())

def format_minutes_as_hhmm(minutes):
    """Formats a duration in minutes as hh:mm after rounding the minutes."""
    minutes = round(minutes)
    hours = minutes // 60
    mins = minutes % 60
    return f"{hours:02d}:{mins:02d}"

def calculate_reading_time(char_count, reading_speed=1000):
    """Estimates reading time in minutes given a character count."""
    return char_count / reading_speed

def extract_urls(text):
    """Extracts unique external URLs from the given text."""
    urls = re.findall(r'https?://[^\s\'"<>]+', text)
    return set(urls)

def analyze_external_links(urls, identify_mimetypes=True):
    """
    If identify_mimetypes is True, sends HEAD requests to each URL
    to tally MIME types; otherwise, returns a dictionary counting links.
    """
    if not identify_mimetypes:
        return {"not_identified": len(urls)}
    
    content_types = {}
    headers = {'User-Agent': 'Mozilla/5.0'}
    for url in urls:
        try:
            r = requests.head(url, allow_redirects=True, headers=headers, timeout=10)
            if r.status_code == 429:
                r = get_with_backoff(url)
            if r.status_code == 405:  # fallback if HEAD not allowed
                r = requests.get(url, stream=True, headers=headers, timeout=10)
            ct = r.headers.get("Content-Type", "").split(";")[0].strip()
            if not ct:
                ct = "unknown"
        except Exception:
            ct = "application/pdf" if url.lower().endswith(".pdf") else "unknown"
        content_types[ct] = content_types.get(ct, 0) + 1
    return content_types

def get_with_backoff(url, max_backoff=60):
    """
    Sends a GET request to the URL. If a 429 Too Many Requests status is received,
    waits with exponential backoff (up to max_backoff seconds) before retrying.
    """
    backoff = 1
    while True:
        try:
            response = requests.get(url, timeout=10)
        except Exception as e:
            print("Error fetching URL:", url, e)
            time.sleep(backoff)
            backoff = min(backoff * 2, max_backoff)
            continue
        if response.status_code == 429:
            print(f"Received 429 for {url}; sleeping {backoff} seconds")
            time.sleep(backoff)
            backoff = min(backoff * 2, max_backoff)
            continue
        return response

def extract_topic_id(discussion_link):
    """
    Extracts the topic ID from a Discourse discussion URL.
    
    First, it attempts to match a pattern where the URL contains a number (e.g. "/t/some-title/123").
    If that fails (as in URLs without the numeric id at the end), it fetches the URL's content and
    searches for a canonical link tag:
      <link rel="canonical" href="https://forum.example.com/t/some-title/12345" />
    and extracts the numerical ID from the canonical URL.
    
    Returns the topic ID as a string if found, or None otherwise.
    """
    match = re.search(r"/t/[^/]+/(\d+)", discussion_link)
    if match:
        return match.group(1)
    try:
        response = requests.get(discussion_link, timeout=10)
        if response.status_code == 200:
            canonical_match = re.search(
                r'<link\s+rel=["\']canonical["\']\s+href=["\']([^"\']+)["\']',
                response.text, re.IGNORECASE
            )
            if canonical_match:
                canonical_url = canonical_match.group(1)
                match2 = re.search(r"/t/[^/]+/(\d+)", canonical_url)
                if match2:
                    return match2.group(1)
    except Exception as e:
        print("Error fetching URL for canonical extraction:", e)
    return None

def fetch_discourse_thread(discussion_link):
    """
    Fetches the full Discourse discussion thread.
    Constructs the API endpoint as BASEDOMAIN/t/NUMBER.json.
    Uses exponential backoff to prevent 429 errors.
    Returns the concatenated text of all posts and the total count of posts.
    """
    topic_id = extract_topic_id(discussion_link)
    if not topic_id:
        print("Could not extract topic ID from:", discussion_link)
        return "", 0
    parsed = urlparse(discussion_link)
    base_domain = f"{parsed.scheme}://{parsed.netloc}"
    endpoint = f"{base_domain}/t/{topic_id}.json"
    full_text = ""
    posts_count = 0
    try:
        response = get_with_backoff(endpoint)
        if response.status_code != 200:
            print(f"Error fetching discourse thread from {endpoint}: {response.status_code}")
            return "", 0
        data = response.json()
        posts = data.get("post_stream", {}).get("posts", [])
        for post in posts:
            post_text = unescape(post.get("cooked", ""))
            full_text += post_text + "\n"
            posts_count += 1
        while data.get("more_posts_url"):
            next_url = base_domain + data["more_posts_url"]
            response = get_with_backoff(next_url)
            if response.status_code != 200:
                break
            data = response.json()
            posts = data.get("post_stream", {}).get("posts", [])
            for post in posts:
                post_text = unescape(post.get("cooked", ""))
                full_text += post_text + "\n"
                posts_count += 1
    except Exception as e:
        print("Exception fetching discourse thread:", e)
    return full_text, posts_count

# ----------------------
# Snapshot Functions
# ----------------------

def fetch_snapshot_proposals(start_epoch, end_epoch, space):
    """Fetch proposals from Snapshot using its GraphQL API."""
    url = "https://hub.snapshot.org/graphql"
    proposals = []
    skip = 0
    batch = 100
    query = """
    query Proposals($first: Int!, $skip: Int!, $space: String!, $created_gte: Int!, $created_lte: Int!) {
      proposals(first: $first, skip: $skip, where: {space: $space, created_gte: $created_gte, created_lte: $created_lte}, orderBy: "created", orderDirection: desc) {
        id
        title
        body
        discussion
        created
      }
    }
    """
    while True:
        variables = {
            "first": batch,
            "skip": skip,
            "space": space,
            "created_gte": start_epoch,
            "created_lte": end_epoch
        }
        response = requests.post(url, json={"query": query, "variables": variables})
        if response.status_code != 200:
            print("Error fetching Snapshot proposals:", response.text)
            break
        data = response.json()
        batch_proposals = data.get("data", {}).get("proposals", [])
        if not batch_proposals:
            break
        proposals.extend(batch_proposals)
        skip += batch
    return proposals

# ----------------------
# Tally Functions (GraphQL)
# ----------------------

def fetch_tally_proposals(start_epoch, end_epoch, governor_id):
    """
    Fetch proposals from Tally using its GraphQL API.
    The provided governor_id is used in the proposals filter.
    Uses cursor-based pagination and sorts proposals by "id" in descending order.
    Filters proposals by creation time using block.timestamp,
    which is parsed from an ISO formatted string (e.g. "2023-06-06T15:56:32Z").
    """
    endpoint = "https://api.tally.xyz/query"
    proposals = []
    limit = 100
    cursor = None
    headers = {
        "Api-Key": "dcd8a84a103c7d3a55047b78206c03a14c8344087a0a5656d116124300a4c78c"
    }
    query = """
    query Proposals($input: ProposalsInput!) {
      proposals(input: $input) {
        nodes {
          ... on Proposal {
            id
            metadata {
              title
              description
              snapshotURL
              discourseURL
            }
            block {
              timestamp
            }
          }
        }
        pageInfo {
          firstCursor
          lastCursor
          count
        }
      }
    }
    """
    while True:
        page_input = {"limit": limit}
        if cursor:
            page_input["afterCursor"] = cursor
        variables = {
            "input": {
                "filters": {"governorId": governor_id},
                "page": page_input,
                "sort": {"sortBy": "id", "isDescending": True}
            }
        }
        response = requests.post(endpoint, json={"query": query, "variables": variables}, headers=headers)
        if response.status_code != 200:
            print("Error fetching Tally proposals:", response.text)
            break
        data = response.json()
        batch = data.get("data", {}).get("proposals", {}).get("nodes", [])
        if not batch:
            break
        for p in batch:
            timestamp_str = p.get("block", {}).get("timestamp", "")
            try:
                dt = datetime.datetime.strptime(timestamp_str, "%Y-%m-%dT%H:%M:%SZ")
                timestamp = int(dt.timestamp())
            except Exception as e:
                print("Error parsing timestamp:", timestamp_str, e)
                timestamp = 0
            if start_epoch <= timestamp <= end_epoch:
                proposals.append(p)
        page_info = data.get("data", {}).get("proposals", {}).get("pageInfo", {})
        new_cursor = page_info.get("lastCursor")
        if not new_cursor or len(batch) < limit:
            break
        cursor = new_cursor
    return proposals

# ----------------------
# Main Analysis Function
# ----------------------

def analyze_proposals(source, identifier, start_date, end_date,
                      identify_mimetypes=False, exclude_discourse=False):
    """
    Analyzes proposals based on the specified parameters.
    source: "snapshot" or "tally"
    identifier: for Snapshot, the DAO space; for Tally, the governor id.
    start_date and end_date: in dd/mm/yyyy format.
    identify_mimetypes: whether to perform MIME type HEAD requests.
    exclude_discourse: whether to exclude discourse reading time.
    
    Returns a dictionary with detailed proposal info and a summary.
    """
    start_epoch = convert_date_to_epoch(start_date)
    end_epoch = convert_date_to_epoch(end_date)
    start_dt = datetime.datetime.strptime(start_date, "%d/%m/%Y")
    end_dt = datetime.datetime.strptime(end_date, "%d/%m/%Y")
    days_count = (end_dt - start_dt).days + 1

    proposals = []
    if source == "snapshot":
        proposals = fetch_snapshot_proposals(start_epoch, end_epoch, identifier)
    elif source == "tally":
        proposals = fetch_tally_proposals(start_epoch, end_epoch, identifier)
    else:
        raise ValueError("Invalid source. Must be 'snapshot' or 'tally'.")

    if not proposals:
        return {"error": "No proposals found for the specified date range."}

    total_proposals = len(proposals)
    total_reading_time = 0.0
    reading_times = []
    proposals_output = []

    for proposal in proposals:
        proposal_details = {}
        if source == "snapshot":
            created_ts = proposal.get("created")
            title = proposal.get("title", "No title")
            vote_body = proposal.get("body", "")
            created_date = datetime.datetime.fromtimestamp(created_ts).strftime("%Y-%m-%d")
            proposal_details["date"] = created_date
            proposal_details["title"] = title
            proposal_details["body_length"] = len(vote_body)
            proposal_details["source"] = "snapshot"
            proposal_details["voting_body"] = {
                "char_count": len(vote_body),
                "reading_time": calculate_reading_time(len(vote_body)),
                "external_links": list(extract_urls(vote_body))
            }
            discussion_link = proposal.get("discussion", "")
            if discussion_link and discussion_link.startswith("http") and "/t/" in discussion_link:
                discourse_text, posts_count = fetch_discourse_thread(discussion_link)
                discourse_char_count = len(discourse_text)
                discourse_reading_time = calculate_reading_time(discourse_char_count)
                posts_urls = list(extract_urls(discourse_text))
            else:
                posts_count = 0
                discourse_char_count = 0
                discourse_reading_time = 0.0
                posts_urls = []
            proposal_details["discourse_thread"] = {
                "posts_count": posts_count,
                "char_count": discourse_char_count,
                "reading_time": discourse_reading_time,
                "external_links": posts_urls
            }
            total_external_urls = list(set(extract_urls(vote_body)).union(set(posts_urls)))
            vote_reading_time = calculate_reading_time(len(vote_body))
            if exclude_discourse:
                proposal_reading_time = vote_reading_time
            else:
                proposal_reading_time = vote_reading_time + discourse_reading_time
        else:  # tally
            timestamp_str = proposal.get("block", {}).get("timestamp", "")
            try:
                dt = datetime.datetime.strptime(timestamp_str, "%Y-%m-%dT%H:%M:%SZ")
                created_ts = int(dt.timestamp())
                created_date = dt.strftime("%Y-%m-%d")
            except Exception as e:
                print("Error parsing Tally timestamp:", timestamp_str, e)
                created_date = "unknown"
                created_ts = 0
            meta = proposal.get("metadata", {})
            title = meta.get("title", "No title")
            vote_body = meta.get("description", "")
            vote_reading_time = calculate_reading_time(len(vote_body))
            proposal_details["date"] = created_date
            proposal_details["title"] = title
            proposal_details["body_length"] = len(vote_body)
            proposal_details["source"] = "tally"
            proposal_details["voting_body"] = {
                "char_count": len(vote_body),
                "reading_time": vote_reading_time,
                "external_links": list(extract_urls(vote_body))
            }
            discourse_url = meta.get("discourseURL", "")
            if not discourse_url:
                candidate_urls = extract_urls(vote_body)
                for url in candidate_urls:
                    if extract_topic_id(url):
                        discourse_url = url
                        break
            if discourse_url and discourse_url.startswith("http") and extract_topic_id(discourse_url):
                discourse_text, posts_count = fetch_discourse_thread(discourse_url)
                discourse_char_count = len(discourse_text)
                discourse_reading_time = calculate_reading_time(discourse_char_count)
                posts_urls = list(extract_urls(discourse_text))
                proposal_details["discourse_thread"] = {
                    "posts_count": posts_count,
                    "char_count": discourse_char_count,
                    "reading_time": discourse_reading_time,
                    "external_links": posts_urls
                }
                if exclude_discourse:
                    proposal_reading_time = vote_reading_time
                else:
                    proposal_reading_time = vote_reading_time + discourse_reading_time
            else:
                proposal_details["discourse_thread"] = None
                proposal_reading_time = vote_reading_time
            total_external_urls = list(set(extract_urls(vote_body)))
        proposal_details["total_external_links"] = total_external_urls
        proposal_details["proposal_reading_time"] = proposal_reading_time
        total_reading_time += proposal_reading_time
        reading_times.append(proposal_reading_time)
        proposals_output.append(proposal_details)

    total_reading_hhmm = format_minutes_as_hhmm(total_reading_time)
    avg_reading_time = total_reading_time / total_proposals if total_proposals else 0
    avg_reading_hhmm = format_minutes_as_hhmm(avg_reading_time)
    median_reading_time = statistics.median(reading_times) if reading_times else 0
    median_reading_hhmm = format_minutes_as_hhmm(median_reading_time)
    daily_reading_time = total_reading_time / days_count if days_count else total_reading_time
    daily_reading_hhmm = format_minutes_as_hhmm(daily_reading_time)

    summary = {
        "dao_identifier": identifier,
        "date_range": {"start": start_date, "end": end_date, "days": days_count},
        "total_proposals": total_proposals,
        "cumulative_reading_time": total_reading_hhmm,
        "average_reading_time_per_proposal": avg_reading_hhmm,
        "median_reading_time_per_proposal": median_reading_hhmm,
        "average_reading_time_per_day": daily_reading_hhmm
    }

    output = {"proposals": proposals_output, "summary": summary}
    return output

def main():
    today = datetime.date.today()
    default_end = today.strftime("%d/%m/%Y")
    default_start = (today - datetime.timedelta(days=90)).strftime("%d/%m/%Y")
    
    parser = argparse.ArgumentParser(
        description="Analyze DAO proposals (using Snapshot or Tally) and output JSON details."
    )
    parser.add_argument("source", choices=["snapshot", "tally"],
                        help="Data source: snapshot or tally")
    parser.add_argument("identifier", help="For Snapshot, the DAO space (e.g. arbitrumfoundation.eth); for Tally, the governor id")
    parser.add_argument("--start-date", default=default_start,
                        help=f"Start date in dd/mm/yyyy (default: {default_start})")
    parser.add_argument("--end-date", default=default_end,
                        help=f"End date in dd/mm/yyyy (default: {default_end})")
    parser.add_argument("--identify-mimetypes", action="store_true",
                        help="If set, perform HEAD requests to identify MIME types of external links; otherwise, only count them.")
    parser.add_argument("--exclude-discourse", action="store_true",
                        help="If set, exclude discourse reading time from total reading time analysis.")
    args = parser.parse_args()

    result = analyze_proposals(args.source, args.identifier, args.start_date, args.end_date,
                               identify_mimetypes=args.identify_mimetypes,
                               exclude_discourse=args.exclude_discourse)
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()

