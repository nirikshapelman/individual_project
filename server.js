const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const axios = require('axios');

const app = express();
const port = 3000;
const API_KEY = '23f86c1deba541fe908154244252602';

app.use(cors());
app.use(express.json());

// Connect to SQLite database
const db = new sqlite3.Database('./wardrobe.db', (err) => {
    if (err) {
        console.error('Error connecting to database:', err.message);
    } else {
        console.log('Connected to SQLite database.');
    }
});

// Weather category mapping
const weatherMapping = {
    "t-shirt": "hot",
    "shorts": "hot",
    "tank top": "hot",
    "jacket": "cold",
    "sweater": "cold",
    "coat": "cold",
    "raincoat": "rain",
    "waterproof jacket": "rain",
    "jeans": "all-weather",
    "sneakers": "all-weather",
    "hoodie": "cold",
    "dress": "hot",
    "boots": "cold",
    "sandals": "hot"
};

async function getWeather(location) {
    try {
        const response = await axios.get(`http://api.weatherapi.com/v1/current.json?key=${API_KEY}&q=${location}`);
        const weather = response.data.current;
        
        return {
            temperature: weather.temp_c,
            feels_like: weather.feelslike_c,
            condition: weather.condition.text.toLowerCase(),
            wind: weather.wind_kph,
            rain: weather.precip_mm,
            uv: weather.uv,
        };
    } catch (error) {
        console.error('Error fetching weather data:', error.message);
        return null;
    }
}

function classifyWeather(weather) {
    if (!weather) return "all-weather";

    if (weather.rain > 0 || weather.condition.includes("rain")) return "rain";
    if (weather.feels_like < 10) return "cold";
    if (weather.feels_like > 25) return "hot";
    if (weather.wind > 30) return "windy";
    if (weather.uv > 6) return "sunny";
    
    return "all-weather";
}

// API Route: Get Clothing Recommendations Based on Weather
app.get('/recommendations/:location', async (req, res) => {
    const { location } = req.params;
    const weather = await getWeather(location);

    if (!weather) {
        return res.status(500).json({ error: "Failed to fetch weather data." });
    }

    const weatherType = classifyWeather(weather);

    db.all(
        'SELECT * FROM clothes WHERE weather_suitability = ? OR weather_suitability = "all-weather"',
        [weatherType], 
        (err, rows) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ weather, recommendedClothes: rows });
        }
    );
});

// Create table if not exists
db.run(`CREATE TABLE IF NOT EXISTS clothes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    color TEXT NOT NULL,
    weather_suitability TEXT
)`);

// Get all clothing items
app.get('/clothes', (req, res) => {
    db.all('SELECT * FROM clothes', [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

// Add a clothing item
app.post('/clothes', (req, res) => {
    let { name, category, color } = req.body;
    
    if (!name || !category || !color) {
        res.status(400).json({ error: 'All fields are required' });
        return;
    }

    // Determine weather suitability
    const weather_suitability = weatherMapping[category.toLowerCase()] || "all-weather"; // Default to "all-weather"

    db.run('INSERT INTO clothes (name, category, color, weather_suitability) VALUES (?, ?, ?, ?)',
        [name, category, color, weather_suitability],
        function (err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ id: this.lastID, name, category, color, weather_suitability });
        }
    );
});

// Delete a clothing item
app.delete('/clothes/:id', (req, res) => {
    const { id } = req.params;
    db.run('DELETE FROM clothes WHERE id = ?', id, function (err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        if (this.changes === 0) {
            res.status(404).json({ error: 'Item not found' });
            return;
        }
        res.json({ message: 'Item deleted' });
    });
});


// Start server
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
