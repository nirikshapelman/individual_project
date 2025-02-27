// cluster test
const http = require('http');
const port = 3000;

const server = http.createServer((req, res) => {
    // Simulate CPU-intensive task
    let count = 0;
    for (let i = 0; i < 1e7; i++) {
        count += i;
    }

    res.writeHead(200);
    res.end(`Handled by single thread with count: ${count}`);
});

server.listen(port, () => {
    console.log(`Server running on port ${port}`);
});