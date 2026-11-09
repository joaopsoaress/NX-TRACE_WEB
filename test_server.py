from flask import Flask, jsonify, abort
import time

app = Flask(__name__)

# Exemple data
programming_info = {
    "languages": [
        {"name": "Python", "paradigm": "Multiparadigm", "usage": "AI, Web, Data Science"},
        {"name": "JavaScript", "paradigm": "Functional/Event-driven", "usage": "Web (Front/Back)"},
        {"name": "SQL", "paradigm": "Declarative", "use": "Database"}
    ],
    "python_version": "3.12"
}

@app.route('/')
def home():
    return jsonify({"message": "Test server running"})

# Endpoint to provide programming information for testing purposes
@app.route('/api/test', methods=['GET'])
def get_info():
    return jsonify(programming_info)

@app.route('/reservations')
def reservations():
    # Simulate some processing time
    time.sleep(0.1)
    return jsonify({
        "data": [
            {"id": 1, "name": "Reservation 1"},
            {"id": 2, "name": "Reservation 2"}
        ],
        "count": 2
    })

@app.route('/users')
def users():
    # Return 401 Unauthorized to test auth detection
    return jsonify({"error": "Authentication required"}), 401

@app.route('/admin')
def admin():
    # Return 403 Forbidden
    return jsonify({"error": "Admin access required"}), 403

@app.route('/slow')
def slow_endpoint():
    # Simulate slow response
    time.sleep(2)
    return jsonify({"message": "Slow response"})

@app.route('/notfound')
def not_found():
    # Return 404
    abort(404)

if __name__ == '__main__':
    print("Starting test server on http://localhost:8000")
    print("Available endpoints:")
    print("  /reservations - Returns 200 OK with data")
    print("  /users - Returns 401 Unauthorized")
    print("  /admin    - Returns 403 Forbidden")
    print("  /slow     - Slow response (2 seconds)")
    print("  /notfound - Returns 404 Not Found")
    app.run(debug=True, port=8000)