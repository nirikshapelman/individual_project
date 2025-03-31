const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const axios = require('axios');
const stringSimilarity = require('string-similarity');
//const kMeans = require('kmeans-js');
const determineWeatherSuitability = require('./nlp');
//const { cluster } = require('kmeans-js'); //unsure
//const ml = require('ml-kmeans'); //working
const { clusterOutfits, getOutfitRecommendation } = require('./cluster'); // clustering merge
const determineCoverageAndPracticality = require('./attributes');


const app = express();
const port = 3000;
const API_KEY = '35ee18a6ae4749d48dc125126250603';

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

// Fetch weather data using the API
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

// Classify the weather based on certain thresholds
function classifyWeather(weather) {
    console.log("Weather object received:", weather); 
    if (!weather) return "all-weather";

    if (weather.rain > 0 || weather.condition.includes("rain")) return "rain";
    if (weather.feels_like < 13) return "cold";
    if (weather.feels_like > 14) return "hot";
    if (weather.wind > 30) return "windy";
    if (weather.uv > 6) return "hot";
    
    return "all-weather";
}

console.log(determineWeatherSuitability("fleece jacket"));


// Fetch clothing items based on the weather classification
async function getClothingItems(weatherType) {
    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM clothes WHERE weather_suitability = ?', [weatherType], (err, rows) => {
            if (err) {
                reject(err);
                return;
            }
            console.log("Fetched Clothing Items:", rows);
            resolve(rows);
        });
    });
}


// Create table for clothes
db.run(`CREATE TABLE IF NOT EXISTS clothes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    color TEXT NOT NULL,
    weather_suitability TEXT
)`);

// Create table for lookbook
db.run(`CREATE TABLE IF NOT EXISTS lookbook (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clothing_id INTEGER,
    date TEXT,
    FOREIGN KEY (clothing_id) REFERENCES clothes(id)
)`);

// db.run(`ALTER TABLE clothes 
//     ADD COLUMN weather_suitability TEXT;`
// );

// db.run(`ALTER TABLE clothes 
//     ADD COLUMN coverage INTEGER;`
// );

// db.run(`ALTER TABLE clothes 
//     ADD COLUMN practicality INTEGER;`
// );


//clustering

app.get('/clothes', (req, res) => {
    db.all('SELECT * FROM clothes', [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows); 
    });
});

// API Route: Get Clothing Recommendations Based on Weather
app.get('/recommendations/:location', async (req, res) => {
    try {
        const { location } = req.params;
        const weather = await getWeather(location);

        if (!weather) {
            return res.status(500).json({ error: "Failed to fetch weather data." });
        }

        const weatherType = classifyWeather(weather);
        console.log("The weather is", weatherType);
        const clothingItems = await getClothingItems(weatherType);

        if (!clothingItems || clothingItems.length === 0) {
            return res.json({ weather, recommendations: [] });
        }

        const clusteredItems = getOutfitRecommendation(clothingItems, 3); 
        console.log("Clustered items:", clusteredItems);
        res.json({ weather, recommendations: clusteredItems });

    } catch (error) {
        console.error("Error processing recommendations:", error);
        res.status(500).json({ error: "An error occurred while fetching recommendations." });
    }
});


function processClothingItem(name) {
    let weatherSuitability = determineWeatherSuitability(name);
    let item = { name, weatherSuitability };
    return determineCoverageAndPracticality(item);
}

console.log(processClothingItem("tank top"));
console.log(processClothingItem("denim shorts"));
console.log(processClothingItem("hoodie"));



// function clusterClothingItems(clothingItems, numClusters) {
//     if (!clothingItems || clothingItems.length === 0) {
//         console.warn("No clothing items available for clustering.");
//         return [];
//     }

//     const features = clothingItems
//         .map(item => [
//             parseFloat(item.coverage) || 1,  
//             parseFloat(item.practicality) || 1 
//         ])
//         .filter(featureSet => featureSet.every(value => !isNaN(value))); 

//     if (features.length === 0) {
//         console.warn("No valid data points for clustering.");
//         return [];
//     }

//     try {
//         const result = ml.kmeans(features, numClusters); 
//         return clothingItems.map((item, i) => ({
//             ...item,
//             cluster: result.clusters[i] 
//         }));
//     } catch (error) {
//         console.error("Error in k-means clustering:", error);
//         return [];
//     }
// }
// Categorize clothing item based on name using string similarity
const givenCategories = {
    "top": ["t-shirt", "hoodie", "sweater", "jacket", "tank top"],
    "bottoms": ["jeans", "shorts", "trousers", "skirt"],
    "footwear": ["trainers", "boots", "heels", "sandals"]
};

function categorizeClothing(name) {
    for (let name in givenCategories) {
        const matches = stringSimilarity.findBestMatch(name.toLowerCase(), givenCategories[name]);
        if (matches.bestMatch.rating > 0.7) {
            return name;
        }
    }
    return "unknown";
}

// Check 
app.get('/cold-weather-items', (req, res) => {
    db.all('SELECT * FROM clothes WHERE weather_suitability = "cold"', [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows); 
    });
});

// Add a clothing item to the database
app.post('/clothes', (req, res) => {
    let { name, category, color } = req.body;

    if (!name || !category || !color) {
        res.status(400).json({ error: 'All fields are required' });
        return;
    }

    // Determine weather suitability, coverage and practicality
    const weather_suitability = determineWeatherSuitability(name);
    const { coverage, practicality } = determineCoverageAndPracticality({ name, weather_suitability });

    console.log('Inserting into DB:', { name, category, color, weather_suitability, coverage, practicality });

    db.run('INSERT INTO clothes (name, category, color, weather_suitability, coverage, practicality) VALUES (?, ?, ?, ?, ?, ?)',
        [name, category, color, weather_suitability, coverage || 1, practicality || 1],
        function (err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ id: this.lastID, name, category, color, weather_suitability, coverage, practicality });
        }
    );
});




// async function clusterCategory(weatherType, category, numClusters) {
//     return new Promise((resolve, reject) => {
//         db.all('SELECT * FROM clothes WHERE weather_suitability = ? AND category = ?', [weatherType, category], (err, rows) => {
//             if (err) {
//                 reject(err);
//                 return;
//             }

//             if (rows.length === 0) {
//                 resolve([]);
//                 return;
//             }

//             // Extract features for clustering
//             const features = rows.map(item => [
//                 parseFloat(item.coverage) || 1,
//                 parseFloat(item.practicality) || 1
//             ]);

//             // Perform clustering
//             try {
//                 const result = ml.kmeans(features, Math.min(numClusters, rows.length));

//                 // Assign clusters back to items
//                 const clusteredItems = rows.map((item, i) => ({
//                     ...item,
//                     cluster: result.clusters[i]
//                 }));

//                 // Pick one representative from each cluster
//                 const selectedItems = [];
//                 const seenClusters = new Set();

//                 for (const item of clusteredItems) {
//                     if (!seenClusters.has(item.cluster)) {
//                         selectedItems.push(item);
//                         seenClusters.add(item.cluster);
//                     }
//                 }

//                 resolve(selectedItems);
//             } catch (error) {
//                 console.error("Error in clustering category:", error);
//                 resolve([]);
//             }
//         });
//     });
// }

// async function getOutfitRecommendation(weatherType) {
//     try {
//         const topClustered = await clusterCategory(weatherType, 'top', 3);
//         const bottomClustered = await clusterCategory(weatherType, 'bottom', 3);
//         const footwearClustered = await clusterCategory(weatherType, 'footwear', 3);

//         return {
//             top: topClustered.length ? topClustered[0] : null,
//             bottom: bottomClustered.length ? bottomClustered[0] : null,
//             footwear: footwearClustered.length ? footwearClustered[0] : null
//         };
//     } catch (error) {
//         console.error("Error getting outfit recommendation", error);
//         return null;
//     }
// }

// Lookbook calls
app.get ('/lookbook',(req, res) => {
    db.all(`
        SELECT lookbook.id, lookbook.date, clothes.name, clothes.category, clothes.color
        FROM lookbook
        JOIN clothes ON lookbook.clothing_id = clothes.id`, [], (err, rows) => {
            if(err) return res.status(500).json ({error: err.message});
            res.json(rows);
        });
});

app.post ('/lookbook',(req, res) => {
    const {clothing_id, date} = req.body;
    db.run ("INSERT INTO lookbook (clothing_id, date) VALUES (?, ?)", [clothing_id, date], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, clothing_id, date });
    });

});

//Analytics calls
app.get ('/analytics',async (req, res) => {
    try {
        const mostWorn = await new Promise((resolve, reject) => {
            db.all(
                `SELECT c.name, c.category, c.color, COUNT(l.clothing_id) AS count
                FROM lookbook l
                JOIN clothes c ON l.clothing_id = c.id
                GROUP BY l.clothing_id
                ORDER BY count DESC
                LIMIT 5;`,
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });

        const leastWorn = await new Promise((resolve, reject) => {
            db.all(
                `SELECT c.name, c.category, c.color, COUNT(l.clothing_id) AS count
                FROM clothes c
                LEFT JOIN lookbook l ON c.id = l.clothing_id
                GROUP BY c.id
                ORDER BY count ASC
                LIMIT 5;`,
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });

        // not sure if I want to keep this

        // const weatherAnalytics = await db.all (
        //     `SELECT w.condition, c.name, COUNT(l.clothing_id) AS count
        //     FROM lookbook l
        //     JOIN clothes c ON l.clothing_id = c.id
        //     JOIN weather w ON l.date = w.date
        //     GROUP BY w.condition, c.id
        //     ORDER BY count DESC;`
        // );

        res.json ({mostWorn , leastWorn})
    } catch (err){
        console.error(err);
        res.status(500).json({error: 'Failed to fetch analytics'});
    }

});

async function getClothingCategories(weatherType, category) {
    return new Promise((resolve, reject) =>{
        db.all('SELECT * FROM clothes WHERE weather_suitability = ? AND category = ?', [weatherType, category], (err, rows) =>{
            if (err) {
                reject(err);
                return;
            }
            resolve(rows);
        })
    })
    
}

// Delete a clothing item from the database
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

// function clusterClothingItems(clothingItems, numClusters) {
//     if (!clothingItems || clothingItems.length === 0) {
//         console.warn("No clothing items available for clustering.");
//         return [];
//     }

//     // Extract relevant features, ensuring they are numbers
//     const features = clothingItems
//         .map(item => [
//             parseFloat(item.coverage) || 1,  
//             parseFloat(item.practicality) || 1 
//         ])
//         .filter(featureSet => featureSet.every(value => !isNaN(value))); 
//     if (features.length === 0) {
//         console.warn("No valid data points for clustering.");
//         return [];
//     }

//     // Perform clustering
//     try {
//         const kmeans = new kMeans();
//         const result = kmeans.cluster(features, numClusters);
//         return result.clusters;
//     } catch (error) {
//         console.error("Error in k-means clustering:", error);
//         return [];
//     }
// }

// Start server
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
