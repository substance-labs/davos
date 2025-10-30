import os

from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
import requests


load_dotenv('/app/.env')
app = Flask(__name__)
CORS(app)


@app.route('/graphql', methods=['POST'])
def graphql():
    data = request.get_json()
    if data and 'query' in data:
        start = int(os.getenv('TEST_START_PROPOSAL', '1759272763'))
        end = int(os.getenv('TEST_END_PROPOSAL', '1759877563'))
        return jsonify({
            "data": {
                "proposals": [
                    {
                        "id": "0xa3bc9590fd3af9f59fbad1296886da60c90853e25f1fc53110d9ebc8bd0618b6",
                        "title": "Emotional Support Meme Fund",
                        "body": "Allocate 5% of the treasury to hire one (1) full-time meme lord to post motivational memes every time the token price drops more than 3%.",
                        "choices": [
                            "For",
                            "Against",
                            "Abstain"
                        ],
                        "start": start,
                        "end": end,
                        "snapshot": 23478903,
                        "state": "active",
                        "scores": [
                            58323.69586072513,
                            31319.728700042833,
                            31.143677783570375
                        ],
                        "scores_by_strategy": [
                            [
                                8.78649368890468,
                                5002.5238769600155,
                                5972.444584339153,
                                47339.94090573705
                            ],
                            [
                                0,
                                4148.62139336,
                                151.03785714807887,
                                27020.069449534752
                            ],
                            [
                                0,
                                0,
                                31.143677783570375,
                                0
                            ]
                        ],
                        "scores_total": 89674.56823855152,
                        "scores_updated": 1759766664,
                        "author": "0x9136fD91Eb5D06f4e9aAE73e55835C6d3599dEFE",
                        "space": {
                            "id": "DAO_test",
                            "name": "DAO Test"
                        }
                    }
                ]
            }
        })
    return jsonify({"error": "Invalid request"})

@app.route('/api/proposals', methods=['GET'])
def get_proposals():
    source = request.args.get('source')
    identifier = request.args.get('identifier')

    if source == 'snapshot' and identifier == 'daotest.eth':
        start = int(os.getenv('TEST_START_PROPOSAL', '1759272763'))
        end = int(os.getenv('TEST_END_PROPOSAL', '1759877563'))
        return jsonify({
            "data": {
                "proposals": [
                    {
                        "id": "0xa3bc9590fd3af9f59fbad1296886da60c90853e25f1fc53110d9ebc8bd0618b6",
                        "title": "Emotional Support Meme Fund",
                        "body": "Allocate 5% of the treasury to hire one (1) full-time meme lord to post motivational memes every time the token price drops more than 3%.",
                        "choices": [
                            "For",
                            "Against",
                            "Abstain"
                        ],
                        "start": start,
                        "end": end,
                        "snapshot": 23478903,
                        "state": "active",
                        "scores": [
                            58323.69586072513,
                            31319.728700042833,
                            31.143677783570375
                        ],
                        "scores_by_strategy": [
                            [
                                8.78649368890468,
                                5002.5238769600155,
                                5972.444584339153,
                                47339.94090573705
                            ],
                            [
                                0,
                                4148.62139336,
                                151.03785714807887,
                                27020.069449534752
                            ],
                            [
                                0,
                                0,
                                31.143677783570375,
                                0
                            ]
                        ],
                        "scores_total": 89674.56823855152,
                        "scores_updated": 1759766664,
                        "author": "0x9136fD91Eb5D06f4e9aAE73e55835C6d3599dEFE",
                        "space": {
                            "id": "DAO_test",
                            "name": "DAO Test"
                        }
                    }
                ]
            }
        })
    return jsonify({"error": "Invalid request"}), 400

@app.route('/setup-agent', methods=['POST'])
def setup_agent():
    # Hardcoded test user address
    user_address = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e"
    
    voter_api = "http://davos-voter-api:3000"
    
    try:
        # 1. Init agent
        create_resp = requests.post(f"{voter_api}/init-agent", json={"userAddress": user_address,
                                                                     "spaceId": "DAO_test"})
        if create_resp.status_code != 200:
            return jsonify({"error": "Failed to init agent", "details": create_resp.text}), 500
        agent_data = create_resp.json()
        agent_address = agent_data.get('predictedAgentAddress')

        # 2. Set KMS
        kms_resp = requests.post(f"{voter_api}/get-kms", json={"userAddress": user_address})
        if kms_resp.status_code != 200:
            return jsonify({"error": "Failed to set KMS", "details": kms_resp.text}), 500
        kms_data = kms_resp.json()
        kms_address = kms_data.get('kmsAddress')
        
        # 3. Finalize agent
        finalize_resp = requests.post(f"{voter_api}/finalize-agent", json={"userAddress": user_address,
                                                                           "spaceId": "DAO_test",
                                                                           "kmsAddress": kms_address})
        if finalize_resp.status_code != 200:
            return jsonify({"error": "Failed to finalize agent", "details": finalize_resp.text}), 500
        finalize_data = finalize_resp.json()
        finalize_agent_id = finalize_data.get('id')

        # 4. Enable for space
        enable_resp = requests.post(f"{voter_api}/spaces/DAO_test/agents", json={"agentId": finalize_agent_id,
                                                                                 "defaultVote": True})
        if enable_resp.status_code != 200:
            return jsonify({"error": "Failed to enable agent for space", "details": enable_resp.text}), 500
        enable_data = enable_resp.json()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/vote-details/<userAddress>/<proposalId>', methods=['GET'])
def get_vote_details(userAddress, proposalId):
    """
    Simulate the vote details endpoint
    Returns mock vote details for testing
    """
    try:
        # Mock vote details data structure matching the TypeScript interface
        vote_details = {
            "success": True,
            "data": {
                "userAddress": userAddress,
                "proposalId": proposalId,
                "spaceId": "dao_test.eth",
                "proposalTitle": "Emotional Support Meme Fund",
                "proposalText": "Allocate 5% of the treasury to hire one (1) full-time meme lord to post motivational memes every time the token price drops more than 3%.",
                "proposalTextHash": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
                "lastUpdated": 1759272763,
                "aiResponse": "Based on the user's ethos and the proposal content, I recommend voting 'yes' as it aligns with the user's stated principles.",
                "aiVoteChoice": "yes",
                "userVoteChoice": None,
                "status": "pending",
                "createdAt": "2025-10-14T10:00:00Z",
                "updatedAt": "2025-10-14T10:00:00Z",
                "lastChecked": "2025-10-14T10:00:00Z"
            }
        }
        
        return jsonify(vote_details)
    except Exception as e:
        return jsonify({
            "success": False,
            "error": "Failed to get vote details",
            "message": str(e)
        }), 500

@app.route('/api/ai-request', methods=['POST'])
def ai_request():
    """
    Simulate the AI analysis request endpoint
    Returns mock AI response for testing
    """
    try:
        data = request.get_json()
        
        # Validate required parameters
        if not data or 'directive' not in data or 'proposal' not in data:
            return jsonify({
                "success": False,
                "error": "Missing required parameters",
                "details": "Both directive and proposal are required"
            }), 400
        
        directive = data.get('directive')
        proposal = data.get('proposal')
        
        # Mock AI response - simulate what OpenAI would return
        mock_ai_response = """Based on the user's ethos and the proposal content, I recommend voting 'yes' for this proposal. 

The proposal appears to align with the user's stated principles of decentralization and community governance. 
The technical implementation seems sound and the benefits to the ecosystem outweigh the potential risks.

Key factors considered:
- Alignment with user's values
- Technical feasibility
- Community impact
- Risk assessment

Final recommendation: YES"""
        
        return jsonify({
            "success": True,
            "response": mock_ai_response
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": "Failed to process request",
            "details": str(e)
        }), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=True)
