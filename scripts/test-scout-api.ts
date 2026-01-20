
async function checkEndpoint() {
    try {
        // Use global fetch (Node 18+)
        const response = await fetch('http://localhost:5000/api/scouts/status');

        console.log(`Status: ${response.status}`);
        console.log(`Content-Type: ${response.headers.get('content-type')}`);

        if (response.status === 200 && response.headers.get('content-type')?.includes('text/html')) {
            console.log("FAIL: Received HTML (Fallback). Route missing.");
        } else if (response.status === 401) {
            console.log("SUCCESS: Received 401 Unauthorized. Route exists.");
        } else if (response.status === 200) {
            console.log("SUCCESS: Received 200 OK (JSON). Route exists and public (unexpected).");
            const data = await response.json();
            console.log("Body:", JSON.stringify(data, null, 2));
        } else {
            console.log(`UNKNOWN: ${response.status}`);
            const text = await response.text();
            console.log("Body:", text);
        }
    } catch (err) {
        console.error("Error:", err);
    }
}

checkEndpoint();
