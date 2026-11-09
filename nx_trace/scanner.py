import argparse
from datetime import datetime
import requests
import time
import sys
import os

BASE_URL = "http://127.0.0.1:8000"
HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": "NX-TRACE-Scanner/1.6.1"
}

def print_banner():
    """Print NX ASCII art banner with eye theme"""
    banner = """
\033[0m
\033[94m╔═══════════════════════════════════════════════════════════════════════════════════════════════════════╗\033[0m
\033[94m║                                                                                                       ║\033[0m
\033[94m║                                   ███╗   ██╗██╗  ██╗                                                  ║\033[0m
\033[94m║                                   ████╗  ██║╚██╗██╔╝                                                  ║\033[0m
\033[94m║                                   ██╔██╗ ██║ ╚███╔╝                                                   ║\033[0m
\033[94m║                                   ██║╚██╗██║ ██╔██╗                                                   ║\033[0m
\033[94m║                                   ██║ ╚████║██╔╝ ██╗                                                  ║\033[0m
\033[94m║                                   ╚═╝  ╚═══╝╚═╝  ╚═╝                                                  ║\033[0m
\033[94m║                                                                                                       ║\033[0m
\033[94m║                                 👁️  N X - T R A C E  👁️                                               ║\033[0m
\033[94m║                               Network Security Scanner v1.6.1                                         ║\033[0m
\033[94m║                                                                                                       ║\033[0m
\033[94m╚═══════════════════════════════════════════════════════════════════════════════════════════════════════╝\033[0m
"""
    print(banner)

def print_separator():
    """Print a separator line"""
    print("\033[90m" + "─" * 60 + "\033[0m")

def print_header(text):
    """Print a section header"""
    print(f"\n\033[1m\033[94m[ {text} ]\033[0m")
    print_separator()

def print_success(text):
    """Print success message"""
    print(f"\033[92m[✓]\033[0m {text}")

def print_error(text):
    """Print error message"""
    print(f"\033[91m[✗]\033[0m {text}")

def print_info(text):
    """Print info message"""
    print(f"\033[94m[i]\033[0m {text}")

def print_warning(text):
    """Print warning message"""
    print(f"\033[93m[!]\033[0m {text}")

def load_endpoints():
    """Load endpoints from file"""
    try:
        with open("endpoints.txt", "r") as file:
            endpoints = [line.strip() for line in file if line.strip()]
            return endpoints
    except FileNotFoundError:
        print_error("endpoints.txt not found!")
        sys.exit(1)
    
def test_endpoint(target, endpoint):
    """Test a single endpoint"""
    url = f"{target}{endpoint}"
    start = time.time()

    result = {
        "endpoint": endpoint,
        "status_code": None,
        "response_time": None,
        "content_length": None,
        "auth_required": False,  # Default to False
        "response_data": None,
        "error": None
    }

    try:
        response = requests.get(url, headers=HEADERS, timeout=10)
        elapsed = time.time() - start
        
        result["status_code"] = response.status_code
        result["response_time"] = round(elapsed, 3)
        result["content_length"] = len(response.content)

        if 'application/json' in response.headers.get('Content-Type', ''):
            try:
                result["response_data"] = response.json()
            except:
                result["response_data"] = {"error": "Failed to parse JSON"}

        auth_detected = False
        
        # Check status codes
        if response.status_code in [401, 403]:
            auth_detected = True
        
        # Check response headers
        if 'WWW-Authenticate' in response.headers:
            auth_detected = True

        # Check response content for auth keywords
        response_text = response.text.lower()
        auth_keywords = ["login", "sign in", "authenticate", "authorization", "access denied", "forbidden", "auth", "unauthorized"]
        if any(keyword in response_text for keyword in auth_keywords):
            auth_detected = True

        result["auth_required"] = auth_detected


    except requests.exceptions.Timeout:
        result["error"] = "Timeout after 10 seconds"
    except requests.exceptions.ConnectionError:
        result["error"] = "Connection refused - is the server running?"
    except requests.exceptions.RequestException as e:
        result["error"] = f"Request error: {str(e)}"
    except Exception as e:
        result["error"] = f"Unexpected error: {str(e)}"

    return result

def print_result_table(results):
    """Print results in a formatted table"""
    print_header("SCAN RESULTS")
    print("\033[97m" + "─" * 70 + "\033[0m")
    print("\033[97mEndpoint              Status    Time       Size        Auth     \033[0m")
    print("\033[97m" + "─" * 70 + "\033[0m")

    for r in results:
        if r["error"]:
            status = "\033[91mERROR\033[0m"
            time_str = "─"
            size_str = "─"
            auth_str = "─"
        else:
            # Color code based on status
            if r["status_code"] == 200:
                status = f"\033[92m{r['status_code']}\033[0m"
            elif r["status_code"] in [401, 403]:
                status = f"\033[91m🔒 {r['status_code']}\033[0m"
            elif r["status_code"] == 404:
                status = f"\033[93m{r['status_code']}\033[0m"
            elif r["status_code"] >= 400:
                status = f"\033[93m{r['status_code']}\033[0m"
            else:
                status = f"\033[94m{r['status_code']}\033[0m"

            time_str = f"{r['response_time']:5.3f}s"
            
            # Format size with KB/MB if large
            if r['content_length'] > 1024*1024:
                size_str = f"{r['content_length']/(1024*1024):5.1f} MB"
            elif r['content_length'] > 1024:
                size_str = f"{r['content_length']/1024:5.1f} KB"
            else:
                size_str = f"{r['content_length']:5} B"

            auth_str = "\033[91m🔒 YES\033[0m" if r['auth_required'] else "\033[92m🔓 NO\033[0m"

        endpoint_display = r['endpoint'][:20] + "..." if len(r['endpoint']) > 20 else r['endpoint']
        print(f"{endpoint_display:23} {status:10} {time_str:10} {size_str:11} {auth_str:10}")

    print("\033[97m" + "─" * 70 + "\033[0m")

def discover_endpoints(target, wordlist=None, output_file="endpoints.txt"):
    """
    Args:
        target: URL to scan
        wordlist: Path to a wordlist file for brute-forcing endpoints
        output_file: File to save discovered endpoints

    Returns:
        List of discovered endpoints

    """

    print_header("ENDPOINT DISCOVERY")
    print_info("Inicianting endpoint discovery...")

    # Default wordlist if none provided
    if not wordlist:
        wordlist = [
            "admin", "dashboard", "manager", "management",
            "api", "v1", "v2", "v3", "rest", "graphql",
            "login", "logout", "register", "auth",
            "users", "user", "accounts", "profile",
            "products", "orders", "payments", "cart",
            "health", "status", "ping", "metrics",
            "docs", "swagger", "openapi", "redoc",
            "backup", "temp", "logs", "config",
            ".env", ".git", "test", "dev",
            "public", "private", "internal",
            "webhook", "callback", "hooks",
            "db", "database", "search", "query",
            "reports", "export", "import", "download"
        ]
    
    discovered = []
    discovered_only = []

    print(f"\n Testing {len(wordlist)} words...")
    print("(This can take a while)\n")

    for i, word in enumerate(wordlist, 1):
        # Create endpoint variations
        variations = [
            f"/{word}",
            f"/api/{word}",
            f"/rest/{word}",
            f"/v1/{word}",
            f"/{word}/v1",
            f"/{word}/api"
        ]

        # Visual progress
        progress = f"[{i}/{len(wordlist)}]"
        print(f"\r{progress} Testing: {word:<20}", end="", flush=True)

        for endpoint in variations:
            url = f"{target}{endpoint}"

            try:
                # Short timeout to not lag
                response = requests.get(url, timeout=2, allow_redirects=False)

                # If it isn't 404, considers found
                if response.status_code != 404:
                    discovered.append({
                        "endpoint": endpoint,
                        "status": response.status_code,
                        "content_type": response.headers.get('Content-Type', 'unknown')
                    })

                    discovered_only.append(endpoint)

                    # Immediatly shows when found
                    status_color = "\033[92m" if response.status_code == 200 else "\033[93m"
                    print(f"\n  ✅ Encontrado: {endpoint:<30} {status_color}[{response.status_code}]\033[0m")
            
            except requests.exceptions.Timeout:
                # Timeout is expected, just ignore it
                pass
            except requests.exceptions.ConnectionError:
                # If it doesn't connect, everything stops
                print_error(f"\nFalha de conexão com {target}")
                return[], []
            except:
                # Ignore other errors
                pass

    print("\n")

    # Discovery's Statistics
    if discovered:
        print_success(f"Discovered {len(discovered)} new endpoints!")

        # Shows summary by status code
        status_count = {}
        for d in discovered:
            status_count[d['status']] = status_count.get(d['status'], 0) + 1
        
        print_info("Summary by status:")
        for status, count in sorted(status_count.items()):
            color = "\033[92m" if status == 200 else "\033[93m" if status < 400 else "\033[91m"
            print(f"  {color}{status}\033[0m: {count} endpoints")
    else:
        print_warning("No new endpoints found :(")

    return discovered, discovered_only

def update_endpoints_file(discovered_endpoints, original_file="endpoints.txt"):
    """
    Update the endpoint file with the newly discovered endpoints 

    Args:
        discovered_endpoints: Discovered endpoints list
        original_file; Original endpoints file

    Returns:
        Full list of endpoints (old + new)
    """

    print_header("UPDATING ENDPOINTS FILE") 

    # Loads existing endpoints
    existing_endpoints = []
    try:
        with open(original_file, "r") as f:
            existing_endpoints = [line.strip() for line in f if line.strip() and not line.startswith('#')]
        print_info(f"Existing endpoints: {len(existing_endpoints)}")
    except FileNotFoundError:
        print_warning("endpoints.txt not found. Creating new file...")
        existing_endpoints = []

    # Extract only the endpoints from the discovered results.
    new_endpoints = discovered_endpoints

    # Combine and remove duplicates (while preserving order)
    all_endpoints = []
    seen = set()

    # Adds existing ones
    for ep in existing_endpoints:
        if ep not in seen:
            all_endpoints.append(ep)
            seen.add(ep)
            
    # Adds new ones
    new_count = 0
    for ep in new_endpoints:
        if ep not in seen:
            all_endpoints.append(ep)
            seen.add(ep)
            new_count += 1

    # Creates a backup for the original file
    if os.path.exists(original_file):
        backup_name = f"endpoints_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt"
        os.rename(original_file, backup_name)
        print_info(f"Backup criado: {backup_name}")

    # Writes new file
    with open(original_file, "w") as f:
        # Explanatory header
        f.write("# NX-TRACE Endpoints File\n")
        f.write(f"# Updated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write("# " + "="*50 + "\n\n")
        
        f.write("# ========== ENDPOINTS FOUND ==========\n\n")

        for endpoint in sorted(all_endpoints): # Sorts alphabetically
            f.write(f"{endpoint}\n")

    print_success(f"{original_file} file updated!")
    print_info(f"Total endpoints: {len(all_endpoints)}")
    print_info(f"   |- Existing: {len(existing_endpoints)}")
    print_info(f"   L- New added: {new_count}")

    if new_count > 0:
        print_info("New endpoints added: ")
        for ep in new_endpoints:
            if ep not in existing_endpoints:
                print(f"   + {ep}")

    return all_endpoints

def main():

    # Parser for command line arguments
    parser = argparse.ArgumentParser(
        description="NX-TRACE - REST API Behavior Analysis Scanner"
    )

    parser.add_argument(
        "--target",
        required=True,
        help="Target URL or IP to scan (e.g. http://192.168.0.15:8000)"
    )

    args = parser.parse_args()

    target = args.target

    # Clear screen and print banner
    if os.name == 'posix': #Linux/Mac
        os.system('clear')
    elif os.name == 'nt':  #Windows
        os.system('cls')

    print_banner()

    print_info(f"TARGET: {target}")

    endpoints = []

    # Ask if they want to enable automatic discovery
    print_header("DISCOVERY_OPTION")
    answer = input("\033[93m?Enable automatic endpoint discovery? (y/n): \033[0m")
    
    if answer.lower() == 'y':
        discovered, discovered_only = discover_endpoints(target)
        
        if discovered:
            endpoints = update_endpoints_file(discovered_only)
            print_info(f"Discovered {len(discovered_only)} new endpoints")
        else:
            print_warning("No endpoints discovered. Using original file...")
            endpoints = load_endpoints()
    else:
        # Use original file
        endpoints = load_endpoints()
    

    print_success(f"Loaded {len(endpoints)} to scan")
    
    print_header("STARTING SCAN")
    
    results = []
    successful = 0
    failed = 0

    print("\n\033[93m[▶] Scanning endpoints...\033[0m\n")

    for i, ep in enumerate(endpoints, 1):
        # Print scanning animation
        animation = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
        print(f"\r\033[94m{animation[i % len(animation)]} Scanning {ep}...\033[0m", end="", flush=True)


        result = test_endpoint(target, ep)
        results.append(result)

        if result["error"]:
            failed += 1
        else:
            successful += 1

         # Clear line and print result
        print(f"\r{' ' * 60}", end="")
        if result["error"]:
            print_error(f"{ep}: {result['error']}")
        else:
            # Determine icon and color
            if result['status_code'] == 200:
                icon = "✅"
                color = "\033[92m"
            elif result['status_code'] in [401, 403]:
                icon = "🔒"
                color = "\033[91m"
            elif result['status_code'] == 404:
                icon = "❓"
                color = "\033[93m"
            else:
                icon = "⚠️"
                color = "\033[93m"
                
            auth_text = "(Auth)" if result['auth_required'] else ""
            print_success(f"{icon} {ep}: {color}{result['status_code']}\033[0m | {result['response_time']:5.3f}s {auth_text}")
        
    print() # New line after scan

        #Print summary
    print_header("SCAN SUMMARY")

    if successful == len(endpoints):
        print_success(f"All {successful} endpoints scanned successfully")
    else:
        print_success(f"Successful: {successful}/{len(endpoints)}")
        if failed > 0:
            print_error(f"Failed: {failed}/{len(endpoints)}")
    
        # Calculate statistics
    successful_results = [r for r in results if not r.get("error")]
    if successful_results:
        avg_time = sum(r['response_time'] for r in successful_results) / len(successful_results)
        print_info(f"Average response time: {avg_time:.3f}s")
        
        auth_required = len([r for r in successful_results if r['auth_required']])
        print_info(f"Endpoints requiring auth: {auth_required}/{len(successful_results)}")

    # Print result table
    print_result_table(results)

    # Generate report
    print_header("GENERATING REPORT")

    try:
        with open("report.txt", "w") as report:
            report.write("=" * 70 + "\n")
            report.write("                     NX-TRACE SCAN REPORT\n")
            report.write("=" * 70 + "\n\n")
            
            report.write(f"Scan Date: {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
            report.write(f"Target URL: {target}\n")
            report.write(f"Endpoints Scanned: {len(endpoints)}\n")
            report.write(f"Successful: {successful}\n")
            report.write(f"Failed: {failed}\n")

            if successful_results:
                avg_time = sum(r['response_time'] for r in successful_results) / len(successful_results)
                report.write(f"Average Response Time: {avg_time:.3f} seconds\n")
            
            report.write("\n" + "-" * 70 + "\n\n")

            for r in results:
                report.write(f"ENDPOINT: {r['endpoint']}\n")
                if r["error"]:
                    report.write(f"  Status: ERROR\n")
                    report.write(f"  Error: {r['error']}\n")
                else:
                    report.write(f"  Status Code: {r['status_code']}\n")
                    report.write(f"  Response Time: {r['response_time']} seconds\n")
                    report.write(f"  Content Length: {r['content_length']} bytes\n")
                    report.write(f"  Authentication Required: {'YES' if r['auth_required'] else 'NO'}\n")
                
                if r.get('response_data'):
                    report.write(f"  Response Data:\n")
                    if isinstance(r['response_data'], dict):
                        for key, value in r['response_data'].items():
                            report.write(f"    {key}: {value}\n")
                report.write("-" * 40 + "\n")

        print_success("Report saved to report.txt")

    except Exception as e:
        print_error(f"Failed to write report: {str(e)}")

    # Print exit banner
    print("\n" + "=" * 70)
    print("\033[1m\033[95m[👁️] SCAN COMPLETE - NX-TRACE Security Scanner [👁️]\033[0m")
    print("=" * 70)
    print("\033[90mReport saved to: report.txt\033[0m")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n\033[91m[✗] Scan interrupted by user\033[0m")
        sys.exit(1)