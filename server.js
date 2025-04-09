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
const bcrypt = require('bcrypt'); // for encryption
const session = require('express-session');



const app = express();
const port = 3000;
const API_KEY = '35ee18a6ae4749d48dc125126250603';

app.use(cors());
app.use(express.json());
app.use('/images', express.static('public/images'));// svg image usage
app.use(express.static('frontend'));

// svg conversion
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// user id isn't processing
app.use(session({
    secret: '123',  
    resave: false,
    saveUninitialized: true,
}));


// Connect to SQLite database
const db = new sqlite3.Database('./wardrobe.db', (err) => {
    if (err) {
        console.error('Error connecting to database:', err.message);
    } else {
        console.log('Connected to SQLite database.');
    }
});

db.run('PRAGMA foreign_keys = ON');

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
async function getClothingItems(weatherType, userId) {
    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM clothes WHERE weather_suitability LIKE ? AND user_id = ?', 
            [`%${weatherType}%`, userId], 
            (err, rows) => {
            if (err) {
                reject(err);
                return;
            }
            console.log("Fetched Clothing Items:", userId, ":", rows);
            resolve(rows);
        });
    });
}

//Create table for account creation
db.run(`CREATE TABLE IF NOT EXISTS account (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
)`);


// Create table for clothes
db.run(`CREATE TABLE IF NOT EXISTS clothes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    color TEXT NOT NULL,
    weather_suitability TEXT,
    FOREIGN KEY (user_id) REFERENCES account(id)
)`);

// db.run(`ALTER TABLE clothes ADD COLUMN svg TEXT;
//     `);

// Create table for lookbook
db.run(`CREATE TABLE IF NOT EXISTS lookbook (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clothing_id INTEGER,
    date TEXT,
    FOREIGN KEY (user_id) REFERENCES account(id),
    FOREIGN KEY (clothing_id) REFERENCES clothes(id)
)`);

// Create table for donations - changed
db.run(`CREATE TABLE IF NOT EXISTS donations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clothing_id INTEGER,
    donated_date TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES account(id),
    FOREIGN KEY (clothing_id) REFERENCES clothes(id) ON DELETE CASCADE
)`);





// db.run(`ALTER TABLE donations ADD COLUMN category TEXT;
// ALTER TABLE donations ADD COLUMN color TEXT;
//     `);

// db.run(`ALTER TABLE clothes 
//     ADD COLUMN weather_suitability TEXT;`
// );

// db.run(`ALTER TABLE clothes 
//     ADD COLUMN coverage INTEGER;`
// );

// db.run(`ALTER TABLE clothes 
//     ADD COLUMN practicality INTEGER;`
// );
app.use(express.urlencoded({ extended: true }));
app.use(express.static('login')); 
//Sign up connection
app.post('/signup', (req, res) => {
    const {email, username,password} = req.body;
    const hashedPassword = bcrypt.hashSync(password,10)

    db.run ('INSERT INTO account (email, name, password) VALUES (?, ?, ?)', [email, username, hashedPassword], function(err) {
        if (err) {
            console.error(err);
            return res.send('Error creating account.');
        }
        const userId = this.lastID;
        res.redirect(`/index.html?userId=${userId}`);
    });
});

//Login connection
app.post('/login', (req, res) => {
    const { email, username, password } = req.body;
    db.get('SELECT * FROM account WHERE email = ? AND name = ?', [email, username],(err,row) => {
        if (err){
            console.error(err);
            return res.status(500).send('Database error');
        }
        if(!row){
            return res.status(400).send('Invalid username');
        }
        bcrypt.compare(password, row.password, (err,result) => {
            if (err){
            console.error(err);
            return res.status(500).send('Checking password');
            }
            if(result){
                req.session.user_id = row.id;
                console.log('Logged in, session user_id:', req.session.user_id);
                res.redirect('/index.html');
            }
            else {
                return res.status(400).send('Invalid password');
            }

        });
    });
});

app.get('/login', (req, res) => {
    res.sendFile(__dirname + '/frontend/login.html');
});

app.get('/analytics-page', (req, res) => {
    res.sendFile(__dirname + '/frontend/analytics.html');
});


//usercreation
app.get('/user/:userId', (req, res) => {
    const userId = req.params.userId;

    // Fetch user data or set up a view for that user
    db.get('SELECT * FROM account WHERE id = ?', [userId], (err, row) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error fetching user data.');
        }
        
        if (!row) {
            return res.status(404).send('User not found.');
        }

        res.send(`Welcome, ${row.name}! Here is your wardrobe.`);

    });
});


app.get('/clothes', (req, res) => {
    const userId = req.session.user_id;

    db.all('SELECT * FROM clothes WHERE user_id = ?', [userId], (err, rows) => {
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
        const userId = req.session.user_id;

        if (!userId) {
            return res.status(401).json({ error: "User not authenticated." });
        }

        if (!weather) {
            return res.status(500).json({ error: "Failed to fetch weather data." });
        }

        const weatherType = classifyWeather(weather);
        console.log("The weather is", weatherType);
        const clothingItems = await getClothingItems(weatherType, userId);

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

    function getClothingName(name, category){
        //const nameLower = name.toLowerCase()
        //const categoryLower = category.toLowerCase();

        if (name.includes('shirt')) {
            return 'shirt';
        } else if (name.includes('trousers') || name.includes('jeans')) {
            return 'trousers';
        } else if (name.includes('tank') || name.includes('halter')|| name.includes('vest')) {
            return 'tank';
        } else if (name.includes('boot')) {
            return 'boot';
        }else if (name.includes('trainer')|| name.includes('af1s')) {
                return 'trainer';
        }else if (name.includes('jumper')|| name.includes('sweater')) {
                    return 'jumper';}
        else if (name.includes('skirt')) {
                        return 'skirt';}
        else if (name.includes('heels')) {
                            return 'heels';}
        else if (name.includes('jacket')|| name.includes('coat')|| name.includes('fleece')) {
                                return 'jacket';}   
        else if (name.includes('shorts')) {
                                    return 'shorts';}        
        // Add more categories 

        else if (category === 'top') {return 'top_svg';}
        else if (category === 'bottoms') {return 'bottom_svg';}
        else if (category === 'footwear') {return 'footwear_svg';}
        return 'other_svg';
    }

    const svg_con = getClothingName(name);

                // SVG manually
                let svgContent = '';

                if (svg_con === 'shirt') {
                    svgContent = `
                        <svg fill="${color}" height="400px" width="400px" version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 511.961 511.961" xml:space="preserve">
                            <g>
                                <g>
                                    <path d="M511.02,165.58c-2.453-5.44-61.653-133.653-180.373-133.653c-4.8,0-9.067,3.2-10.24,7.893
                                    c-0.64,2.24-16.107,56.107-64.427,56.107S192.193,42.06,191.553,39.82c-1.28-4.693-5.44-7.893-10.24-7.893
                                    C62.594,31.927,3.394,160.14,0.94,165.58c-1.92,4.267-0.853,9.387,2.773,12.48L78.38,242.7c4.48,3.84,11.2,3.413,15.04-1.067
                                    c0.213-0.213,0.32-0.427,0.427-0.533l12.8-17.067v245.333c0,5.867,4.8,10.667,10.667,10.667h277.333
                                    c5.867,0,10.667-4.8,10.667-10.667v-245.44l12.8,17.067c3.52,4.693,10.24,5.653,14.933,2.133c0.213-0.107,0.427-0.32,0.533-0.427
                                    l74.667-64.64C511.874,174.967,512.94,169.954,511.02,165.58z M428.354,219.02l-25.173-33.493
                                    c-3.84-5.12-11.307-5.76-16.107-1.173c-2.133,2.027-3.093,4.907-3.093,7.893v266.347h-256V192.14c0-4.48-2.667-8.747-6.933-10.24
                                    c-4.587-1.707-9.493,0-12.267,3.627L83.607,219.02l-59.733-51.627c13.44-25.173,64.427-109.12,149.76-113.92
                                    c9.707,25.707,35.733,63.787,82.347,63.787s72.64-38.08,82.347-63.787c85.333,4.8,136.32,88.853,149.76,113.92L428.354,219.02z"/>
                                </g>
                            </g>
                        </svg>`;
                } 

                if (svg_con === 'tank' ){
                    svgContent = `<svg fill="${color}" height="400px" width="400px" version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" 
                    viewBox="0 0 469.227 469.227" xml:space="preserve">
                <g>
                    <g>
                        <path d="M401.306,431.573c-2.56-26.773-8.32-42.773-13.44-56.853c-5.547-15.36-10.347-28.693-10.453-54.187
                            c0.747-5.44,6.72-46.933,22.4-73.28c26.24-43.947,22.72-64.96,18.667-89.173l-0.747-4.693
                            c-3.52-22.187-21.867-65.067-49.707-75.84V0h-21.333v76.053c-11.307,3.84-17.28,14.933-22.4,24.427
                            c-6.933,12.907-14.72,27.52-34.987,35.84c-49.92,20.587-114.133,10.133-137.387-22.293c-3.307-4.587-6.08-8.96-8.64-12.8
                            c-6.4-9.707-12.16-18.453-20.587-23.04V0h-21.333v76.053c-25.387,7.253-46.4,47.147-51.2,77.227
                            c-4.693,29.44-3.307,55.467,17.707,93.547c22.613,40.96,22.613,49.707,22.613,72.96c0,15.36-4.053,28.373-9.173,44.8
                            c-5.547,17.813-11.947,38.08-14.72,67.733c-1.28,13.013-2.347,24.32,4.8,31.467c2.667,2.667,6.187,4.267,9.813,4.587
                            c1.28,0.533,2.667,0.853,4.053,0.853h297.387c1.493,0,2.88-0.32,4.267-0.853c3.947-0.32,7.68-2.027,10.453-4.907
                            c6.613-6.827,5.547-16.853,4.373-27.413L401.306,431.573z M379.332,448H88.559c-0.533-0.213-1.067-0.427-1.6-0.533
                            c0-4.693,0.32-9.28,0.853-13.973c2.56-26.667,8.533-45.76,13.76-62.72c5.227-16.853,10.133-32.533,10.133-51.2
                            c0-25.707,0-37.44-25.28-83.307c-20.053-36.373-18.667-58.56-15.36-80c4.8-30.4,26.027-60.48,38.08-60.48h0.32
                            c0,0,7.68,4.587,15.68,16.853c2.667,4.053,5.653,8.64,9.173,13.547c29.013,40.533,103.68,54.08,162.88,29.653
                            c27.307-11.307,37.867-31.04,45.653-45.547c6.4-11.947,11.733-13.44,11.733-13.44h0.32c0.427,0,0.853,0,1.28,0.107
                            c17.707,2.133,36.587,38.08,40.107,60.373l0.747,4.8c3.627,21.653,6.293,37.333-15.893,74.56
                            c-19.093,32.107-25.067,80-25.28,82.027c0,0.427-0.107,0.853-0.107,1.28c0,29.547,5.653,45.227,11.733,61.867
                            c4.907,13.547,9.92,27.52,12.267,51.52l0.533,4.907c0.32,2.667,0.64,6.293,0.747,8.853
                            C380.612,447.467,379.972,447.68,379.332,448z"/>
                    </g>
                </g>
                </svg>`;
                };

                if (svg_con === 'boot' ){
                    svgContent = `<svg fill="${color}" height="400px" width="400px" version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" 
                    viewBox="0 0 469.227 469.227" xml:space="preserve">
                <g>
                    <g>
                        <path d="M505.59,365.338c-0.806-0.625-1.665-1.145-2.549-1.604l-3.834-26.839c-2.959-20.706-20.819-36.245-41.604-36.245
                        c-0.083,0-0.168,0-0.25,0c-29.232,0.192-72.762-2.591-116.807-16.422c1.067-3.137,0.103-6.691-2.577-8.835l-83.23-66.585
                        L229.656,83.405c-0.749-3.748-4.039-6.444-7.861-6.444c-1.223,0-30.165,0.332-49.426,29.224c-0.417,0.625-0.727,1.29-0.948,1.972
                        c-3.534-0.259-7.137-0.013-10.661,0.919c-18.329,4.851-76.337,24.644-76.337,24.644c-6.17,2.055-12.596,3.099-19.099,3.099H42.221
                        c-18.566,0-33.67,15.105-33.67,33.67v173.692c-1.306,0.734-2.529,1.639-3.626,2.726C1.75,350.052,0,354.236,0,358.685v59.786
                        c0,9.136,7.432,16.568,16.568,16.568h136.818c9.136,0,16.568-7.432,16.568-16.568v-3.992c9.119,1.356,18.173,2.745,27.003,4.1
                        c55.158,8.465,107.258,16.46,170.207,16.46c68.71,0,115.703-10.877,132.719-15.553c7.134-1.96,12.116-8.524,12.116-15.961v-25.069
                        C512,373.282,509.663,368.501,505.59,365.338z M457.448,316.684c0.052,0,0.103,0,0.155,0c12.849,0,23.896,9.638,25.73,22.479
                        l3.48,24.363c-21.752,5.214-62.933,12.724-119.649,12.724c-61.653,0-113.086-7.899-167.539-16.262
                        c-5.539-0.851-11.098-1.704-16.686-2.551c16.375-15.023,52.669-38.609,111.649-27.708c10.166,1.879,20.593-2.864,25.954-11.798
                        l11.715-19.526C379.465,313.822,426.302,316.866,457.448,316.684z M215.406,93.907l19.866,99.33l-23.458-18.766l-10.224-40.897
                        c-2.113-8.454-7.301-15.611-14.634-20.258C196.405,100.235,208.238,95.56,215.406,93.907z M24.585,170.489
                        c0-9.725,7.912-17.637,17.637-17.637h23.103c8.229,0,16.362-1.319,24.168-3.922l57.813-19.271l7.138,35.694
                        c1.545,7.724-0.433,15.648-5.427,21.739c-4.994,6.092-12.376,9.585-20.252,9.585h-60.89c-17.064,0-32.457,7.251-43.29,18.823
                        V170.489z M24.585,256c0-23.871,19.42-43.29,43.29-43.29h60.891c12.7,0,24.601-5.633,32.651-15.454s11.24-22.595,8.75-35.048
                        l-7.42-37.103l1.902-0.476c4.568-1.142,9.312-0.436,13.351,1.987c4.039,2.424,6.893,6.275,8.037,10.845l10.88,43.522
                        c0.425,1.703,1.398,3.219,2.77,4.316l31.011,24.809l-14.569,14.569c-3.131,3.131-3.131,8.207,0,11.337
                        c1.565,1.565,3.617,2.348,5.668,2.348s4.104-0.782,5.668-2.348l15.829-15.829l9.573,7.659l-13.936,13.936
                        c-3.131,3.131-3.131,8.207,0,11.337c1.565,1.565,3.617,2.348,5.668,2.348c2.051,0,4.104-0.782,5.668-2.348l15.195-15.195
                        l9.573,7.659l-13.302,13.302c-3.131,3.131-3.131,8.207,0,11.337c1.565,1.565,3.617,2.348,5.668,2.348
                        c2.051,0,4.103-0.782,5.668-2.348l14.563-14.563l9.573,7.659l-12.67,12.67c-3.131,3.131-3.131,8.207,0,11.337
                        c1.565,1.565,3.617,2.348,5.668,2.348s4.103-0.782,5.668-2.348l13.929-13.929l12.679,10.144l-15.687,26.145
                        c-1.938,3.229-5.669,4.949-9.292,4.281c-20.076-3.711-88.985-11.723-134.091,40.568c-42.169-6.119-86.812-11.387-138.826-12.33
                        V256z M495.967,403.526c0,0.245-0.134,0.446-0.332,0.5c-16.388,4.504-61.711,14.981-128.469,14.981
                        c-61.726,0-113.239-7.906-167.776-16.274c-11.816-1.814-24.033-3.689-36.301-5.467c-0.384-0.056-0.767-0.083-1.15-0.083
                        c-1.914,0-3.78,0.686-5.246,1.955c-1.759,1.522-2.771,3.735-2.771,6.062v13.273c0,0.295-0.239,0.534-0.534,0.534H16.569
                        c-0.295,0-0.534-0.239-0.534-0.534v-59.786c0-0.142,0.059-0.273,0.176-0.389c0.12-0.12,0.269-0.172,0.405-0.177
                        c69.551,0.665,125.994,9.333,180.577,17.716c55.075,8.459,107.096,16.449,169.972,16.449c62.73,0,107.25-8.996,128.204-14.357
                        c0.082-0.021,0.218-0.056,0.388,0.076c0.209,0.162,0.209,0.374,0.209,0.454V403.526z"/>
                    </g>
                </g>
                </svg>`;
                };
                
                if (svg_con === 'trainer' ){
                    svgContent = `<svg fill="${color}" height="400px" width="400px" version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" 
                        viewBox="0 0 512.001 512.001" xml:space="preserve">
                    <g>
                        <g>
                            <path d="M512,286.181c0-25.883-19.466-47.575-45.279-50.458c-12.791-1.428-25.452-3.799-37.631-7.046
                                c-47.174-12.581-175.441-69.322-213.63-86.413c-12.825-5.74-27.546-3.012-37.506,6.949l-44.676,44.676
                                c-4.754,4.754-11.67,6.387-18.048,4.261l-50.225-16.742c-3.717-1.239-6.212-4.702-6.212-8.618v-4.776
                                c0-9.136-7.432-16.568-16.568-16.568h-9.592c-13.228,0-24.24,10.342-25.07,23.542L0.048,294.51
                                c-0.471,8.971,2.548,17.512,8.505,24.176v37.452c0,9.136,7.432,16.568,16.568,16.568h282.187
                                c83.725,0,149.941-16.607,174.523-23.747c6.73-1.955,12.38-6.657,15.502-12.901l13.821-27.641
                                c0.569-1.137,0.837-2.364,0.837-3.585h0.01v-18.651H512z M424.96,244.167c12.946,3.454,26.4,5.973,39.982,7.49
                                c1.013,0.113,2.011,0.274,2.995,0.469c-2.903,0.94-6.21,1.95-9.989,3.013c-16.009,4.503-43.511,10.801-83.625,15.225
                                c-6.915,0.762-13.305,3.531-18.477,8.005l-11.887,10.283c-0.584-0.187-1.194-0.316-1.831-0.366
                                c-21.583-1.66-44.209-3.983-66.641-6.642l61.277-36.71c27.142,0.234,45.476-3.511,55.729-11.332
                                C405.182,238.189,416.306,241.859,424.96,244.167z M199.161,271.386c-8.488-1.26-16.685-2.512-24.5-3.733l52.459-31.426
                                c3.696-2.215,8.048-3.012,12.253-2.247c5.879,1.071,11.628,2.061,17.257,2.978L199.161,271.386z M281.682,240.641
                                c9.204,1.195,17.982,2.147,26.295,2.85l-58.325,34.941c-8.574-1.115-17.044-2.261-25.342-3.419L281.682,240.641z M327.205,303.144
                                l-21.91,18.953c-26.719-0.708-50.868-2.316-74.414-3.886c-30.362-2.025-61.73-4.109-98.421-4.277l-22.658-40.785
                                C148.438,279.946,243.427,295.818,327.205,303.144z M23.559,175.993c0.304-4.775,4.286-8.515,9.071-8.515h9.592
                                c0.295,0,0.534,0.239,0.534,0.534v4.776c0,10.829,6.903,20.405,17.176,23.83l50.224,16.742
                                c12.177,4.057,25.379,0.943,34.456-8.134l44.676-44.676c5.217-5.217,12.919-6.651,19.62-3.651c2.999,1.342,6.265,2.8,9.754,4.354
                                l-8.111,8.816c-2.997,3.258-2.787,8.33,0.471,11.328c1.54,1.417,3.486,2.116,5.426,2.116c2.163,0,4.32-0.871,5.901-2.589
                                l11.787-12.812c4.372,1.93,8.959,3.948,13.72,6.035l-6.873,7.47c-2.997,3.258-2.787,8.33,0.471,11.328
                                c1.54,1.417,3.486,2.116,5.426,2.116c2.163,0,4.32-0.871,5.901-2.589l10.62-11.544c4.502,1.955,9.108,3.946,13.788,5.961
                                l-5.774,6.276c-2.997,3.258-2.787,8.33,0.471,11.328c1.54,1.417,3.486,2.116,5.426,2.116c2.163,0,4.32-0.871,5.901-2.589
                                l9.605-10.44c4.592,1.955,9.221,3.916,13.87,5.872l-4.84,5.261c-2.997,3.258-2.787,8.33,0.471,11.328
                                c1.54,1.417,3.486,2.116,5.426,2.116c2.163,0,4.32-0.871,5.901-2.589l8.777-9.54c16.93,7.023,33.704,13.798,49.148,19.745
                                c-22.78,5.986-69.02,3.414-129.332-7.571c-8.032-1.463-16.331,0.051-23.365,4.266l-68.84,41.241
                                c-25.494-4.175-44.266-7.546-51.618-8.889c-9.584-12.272-22.411-21.776-37.134-27.297l-40.02-15.007L23.559,175.993z
                                M16.053,295.434l4.16-66.186l35.443,13.291c15.312,5.742,28.118,16.777,36.06,31.072l22.392,40.306H33.671
                                c-4.887,0-9.431-1.953-12.795-5.498C17.513,304.873,15.801,300.233,16.053,295.434z M482.992,328.887
                                c-1.13,2.259-3.183,3.964-5.634,4.675c-18.666,5.421-86.094,23.11-170.051,23.11H25.12c-0.295,0-0.534-0.239-0.534-0.534v-26.206
                                c0.177,0.012,0.356,0.018,0.536,0.018h102.612c38.213,0,70.682,2.164,102.08,4.257c31.662,2.111,64.401,4.294,103.147,4.294
                                c68.437,0,127.284-13.172,155.625-20.801L482.992,328.887z M495.966,298.918c-19.041,5.659-85.41,23.55-163.006,23.55
                                c-1.201,0-2.381-0.009-3.572-0.013l36.946-31.96c2.665-2.306,6.125-3.795,9.744-4.194c65.653-7.241,99.593-19.348,110.463-23.861
                                c5.867,6.237,9.424,14.604,9.424,23.74V298.918z"/>
                        </g>
                    </g>
                    </svg>`;
                    }

                    if (svg_con === 'top' ){
                        svgContent = `<svg fill="${color}" height="400px" width="400px" version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" 
                        viewBox="0 0 512 512" xml:space="preserve">
                    <g>
                        <g>
                            <path d="M511.891,186.273L491.767,65.534c-3.884-23.307-21.206-42.069-44.128-47.8l-55.682-13.92
                                c-10.122-2.531-20.545-3.814-30.98-3.814H151.02c-10.435,0-20.858,1.283-30.98,3.814l-55.68,13.919
                                c-22.922,5.73-40.244,24.494-44.128,47.8L0.11,186.273c-0.635,3.811,1.537,7.531,5.168,8.852l88.785,32.286v276.572
                                c0,4.427,3.589,8.017,8.017,8.017h307.841c4.427,0,8.017-3.589,8.017-8.017V227.41l88.785-32.286
                                C510.353,193.805,512.526,190.084,511.891,186.273z M333.08,16.034c-4.024,38.978-37.056,69.478-77.081,69.478
                                s-73.055-30.5-77.081-69.478H333.08z M151.02,16.034h11.799c4.08,47.833,44.31,85.511,93.181,85.511s89.101-37.678,93.181-85.511
                                h11.797c2.142,0,4.283,0.067,6.42,0.19c-1.959,27.089-13.581,52.275-33.114,71.469c-21.014,20.65-48.816,32.023-78.283,32.023
                                c-29.356,0-57.083-11.299-78.073-31.816c-19.648-19.206-31.362-44.484-33.33-71.676C146.735,16.101,148.877,16.034,151.02,16.034z
                                M94.063,210.35l-77.042-28.016l2.649-15.891l74.394,26.782V210.35z M401.904,495.966H110.097v-18.171h291.807V495.966z
                                M409.921,119.714c-4.427,0-8.017,3.589-8.017,8.017V461.76H110.097V127.731c0-4.427-3.589-8.017-8.017-8.017
                                c-4.427,0-8.017,3.589-8.017,8.017v48.452l-71.715-25.817l13.7-82.198c2.835-17.006,15.474-30.698,32.201-34.879l55.68-13.92
                                c1.576-0.394,3.162-0.741,4.753-1.066c2.445,30.753,15.789,59.315,38.038,81.063c24.003,23.462,55.71,36.384,89.28,36.384
                                c33.697,0,65.49-13.005,89.522-36.62c22.119-21.734,35.362-50.192,37.794-80.826c1.591,0.325,3.178,0.671,4.753,1.066
                                l55.682,13.92c16.727,4.182,29.367,17.873,32.201,34.88l13.7,82.197l-71.715,25.817v-48.452
                                C417.937,123.304,414.348,119.714,409.921,119.714z M417.937,210.35v-17.125l74.394-26.782l2.649,15.891L417.937,210.35z"/>
                        </g>
                    </g>
                    </svg>`;
                    }
                    if (svg_con === 'jumper' ){
                        svgContent = `<svg fill="${color}" height="400px" width="400px" version="1.1" id="Capa_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" 
                        viewBox="0 0 399.199 399.199" xml:space="preserve">
                    </g>
                        </g>
                    <path d="M354.334,118.897c-11.729-51.721-25.311-75.372-25.311-75.372C301.385,18.658,256.984,1.211,254.81,0.351
                        c-1.539-0.609-3.279-0.417-4.65,0.515c-0.379,0.258-11.037,10.668-50.561,10.668h-0.002l0,0c-39.627,0-50.223-10.439-50.561-10.668
                        c-1.371-0.932-3.113-1.124-4.65-0.515C142.213,1.21,94.488,18.658,70.17,43.522c-0.762,0.779-13.578,23.654-25.307,75.375
                        c-10.734,47.333-22.34,129.157-16.695,250.19v25.111c0,2.76,2.238,5,5,5h45.336c2.416,0,4.486-1.729,4.918-4.105l4.568-25.082
                        l9.141-38.57c1.355,5.461,2.895,10.711,4.635,15.709l4.525,25.914c0.418,2.393,2.496,4.141,4.926,4.141H287.98
                        c2.43,0,4.508-1.748,4.926-4.141l4.525-25.914c1.74-4.998,3.279-10.248,4.635-15.711l9.139,38.572l4.568,25.082
                        c0.434,2.377,2.504,4.105,4.92,4.105h45.338c2.762,0,5-2.24,5-5v-25.111C376.676,248.054,365.068,166.23,354.334,118.897z
                        M199.597,21.533L199.597,21.533h0.002c23.824,0,38.176-3.4,46.559-6.779c-5.727,15.147-24.424,26.286-46.559,26.286h-0.002l0,0
                        c-22.135,0-40.832-11.139-46.557-26.286C161.424,18.133,175.773,21.533,199.597,21.533z M210.361,50.254l-10.764,11.517
                        l-10.762-11.517c3.488,0.515,7.086,0.786,10.762,0.786l0,0h0.002C203.275,51.04,206.871,50.769,210.361,50.254z M74.332,389.199
                        H38.168v-15.215h38.934L74.332,389.199z M94.793,126.687c-4.342,47.976-11.029,121.925-2.295,180.933L79.14,363.984H37.947
                        c-5.066-116.893,6.127-196.08,16.498-242.118c8.771-38.941,18.416-61.26,22.438-69.556c6.85,3.216,20.727,12.565,20.727,35.573
                        C97.609,95.57,96.367,109.302,94.793,126.687z M115.418,367.204l-2.842-16.287h174.045l-2.844,16.287H115.418z M296.705,306.87
                        c-0.018,0.086-4.371,23.752-7.721,34.047H110.213c-3.35-10.291-7.703-33.963-7.723-34.06c-8.717-57.789-2.057-131.547,2.262-179.268
                        c1.596-17.636,2.857-31.567,2.857-39.706c0-25.794-14.723-38.092-24.143-43.32c16.563-13.689,45.807-26.953,58.471-32.365
                        c2.756,13.782,13.293,25.549,27.938,32.412l26.07,27.899c0.984,1.054,2.318,1.586,3.654,1.586c1.223,0,2.449-0.446,3.414-1.347
                        c0.084-0.079,26.307-28.139,26.307-28.139c14.646-6.862,25.184-18.631,27.939-32.413c12.662,5.41,41.9,18.667,58.471,32.365
                        c-9.42,5.228-24.141,17.527-24.141,43.321c0,8.139,1.26,22.068,2.855,39.704C298.765,175.311,305.426,249.077,296.705,306.87z
                        M361.031,389.199h-36.166l-2.771-15.215h38.938V389.199z M361.25,363.984h-41.195l-13.355-56.367
                        c8.736-59.006,2.047-132.956-2.295-180.93c-1.572-17.385-2.814-31.116-2.814-38.803c0-23.015,13.885-32.363,20.721-35.573
                        C331.474,71.278,369.935,163.781,361.25,363.984z"/>
                    </g>
                </g>
                    </svg>`;
                    }
                    if (svg_con === 'trousers' ){
                    svgContent = `<svg fill="${color}" height="400px" width="400px" version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" 
                    viewBox="0 0 511.999 511.999" xml:space="preserve">
                <g>
                    <g>
                        <path d="M367.505,41.894c-0.285-0.296-0.578-0.584-0.874-0.864V8.017c0-4.427-3.589-8.017-8.017-8.017H153.386
                            c-4.427,0-8.017,3.589-8.017,8.017v33.013c-0.297,0.28-0.589,0.568-0.874,0.864c-4.778,4.959-7.268,11.479-7.014,18.359
                            l16.446,444.026c0.159,4.31,3.698,7.721,8.011,7.721h76.96c4.427,0,8.017-3.589,8.017-8.017V161.936
                            c0-5.01,4.076-9.086,9.086-9.086c5.01,0,9.086,4.076,9.086,9.086v342.046c0,4.427,3.589,8.017,8.017,8.017h76.96
                            c4.312,0,7.852-3.411,8.011-7.721l16.443-444.025C374.773,53.372,372.283,46.852,367.505,41.894z M306.771,16.033h43.825v18.2
                            c-0.391-0.018-0.785-0.029-1.18-0.029h-42.645V16.033z M161.402,16.033h43.825v18.171h-42.645c-0.396,0-0.788,0.012-1.18,0.029
                            V16.033z M153.503,59.66c-0.092-2.489,0.808-4.847,2.536-6.641c1.728-1.794,4.052-2.781,6.543-2.781h25.542v9.086
                            c0,18.689-14.836,33.97-33.348,34.704L153.503,59.66z M247.982,138.137c-9.93,3.354-17.102,12.752-17.102,23.8v334.029h-61.218
                            l-14.293-385.921c27.078-1.047,48.789-23.392,48.789-50.722v-9.086h43.825V138.137z M221.26,34.205V16.033h69.478v18.171H221.26z
                            M342.337,495.967h-61.219V161.937c0-11.048-7.172-20.446-17.102-23.8V50.238h43.825v9.086c0,27.331,21.71,49.675,48.789,50.722
                            L342.337,495.967z M357.222,94.027c-18.511-0.733-33.348-16.015-33.348-34.704v-9.086h25.542c2.491,0,4.814,0.988,6.543,2.781
                            c1.728,1.794,2.628,4.152,2.536,6.641L357.222,94.027z"/>
                    </g>
                </g>
                </svg>`;
                }
                    if (svg_con === 'skirt' ){
                        svgContent = `<svg fill="${color}" height="400px" width="400px" version="1.1" id="Capa_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" 
                        viewBox="0 0 371.18 371.18" xml:space="preserve">
                    <path d="M371.027,282.874c-20.634-81.725-50.379-137.29-71.698-169.512c-21.802-32.952-39.185-48.698-41.909-51.075
                        c-6.863-8.099-6.892-19.942-6.891-20.048c0.014-1.335-0.506-2.621-1.445-3.57c-0.939-0.949-2.219-1.483-3.555-1.483H125.65
                        c-1.336,0-2.615,0.534-3.555,1.483c-0.939,0.949-1.459,2.235-1.445,3.57c0.002,0.119-0.069,11.997-6.891,20.048
                        c-2.725,2.377-20.107,18.123-41.909,51.075c-21.318,32.222-51.063,87.787-71.698,169.512c-0.354,1.399-0.085,2.883,0.736,4.069
                        c1.33,1.922,34.303,47.051,184.701,47.051s183.371-45.129,184.701-47.051C371.112,285.757,371.381,284.273,371.027,282.874z
                        M339.795,297.449c-6.099,3.137-13.703,6.432-23.097,9.593c-9.307-82.759-33.113-142.765-51.686-178.813
                        c-13.667-26.528-26.354-44.089-33.636-53.208c1.769-0.213,3.43-0.431,4.994-0.65C305.415,136.645,335.863,277.919,339.795,297.449z
                        M185.59,323.994c-10.258,0-19.916-0.223-29.042-0.622c5.752-139.513,21.284-208.582,29.056-235.248
                        c7.774,26.576,23.266,95.414,29.029,235.267C205.498,323.782,195.83,323.994,185.59,323.994z M158.613,76.688
                        c-5.796,10.287-16.668,31.23-27.906,61.507c-14.508,39.086-32.205,101.501-35.273,178.86c-12.035-2.108-22.385-4.54-31.214-7.072
                        c8.964-81.945,32.379-141.238,50.612-176.736c16.708-32.528,32.163-51.466,37-57.033C153.987,76.385,156.25,76.544,158.613,76.688z
                        M139.963,141.995c12.972-35.017,25.698-57.681,29.911-64.786c2.73,0.09,5.575,0.156,8.531,0.199
                        c-6.904,20.371-25.36,88.225-31.845,245.449c-15.366-0.934-29.031-2.398-41.179-4.199
                        C108.255,242.209,125.686,180.537,139.963,141.995z M192.774,77.408c2.956-0.043,5.801-0.109,8.531-0.199
                        c4.213,7.105,16.939,29.77,29.911,64.786c14.282,38.555,31.72,100.255,34.584,176.738c-12.216,1.798-25.887,3.233-41.181,4.147
                        C218.137,165.633,199.678,97.777,192.774,77.408z M240.473,138.194c-11.24-30.283-22.112-51.223-27.907-61.507
                        c2.364-0.144,4.626-0.303,6.782-0.475c4.834,5.564,20.29,24.501,37,57.033c18.239,35.51,41.664,94.831,50.621,176.82
                        c-8.986,2.582-19.335,4.997-31.22,7.068C272.689,239.738,254.985,177.294,240.473,138.194z M130.284,47.186h110.611
                        c0.52,3.996,1.77,9.815,4.776,15.464c-9.309,1.899-28.703,4.813-60.082,4.813c-31.235,0-50.721-2.927-60.075-4.825
                        C128.516,56.993,129.766,51.178,130.284,47.186z M10.484,282.821c20.19-78.714,48.831-132.295,69.408-163.489
                        c18.28-27.713,33.563-43.088,38.765-47.975c1.01,0.254,2.289,0.555,3.852,0.887c-29.599,29.162-55.342,74.64-76.605,135.416
                        c-13.335,38.114-20.923,71.511-23.639,84.48C15.936,288.088,12.27,284.695,10.484,282.821z M31.4,297.372
                        c3.994-19.817,34.453-160.808,103.408-223.001c1.564,0.22,3.225,0.438,4.995,0.65c-7.276,9.114-19.962,26.668-33.637,53.208
                        c-18.566,36.035-42.363,96.014-51.677,178.73C50.036,305.465,40.59,302.59,31.4,297.372z M348.931,292.215
                        c-2.702-12.914-10.294-46.365-23.654-84.555c-21.265-60.779-47.01-106.254-76.61-135.415c1.563-0.332,2.844-0.634,3.854-0.888
                        c11.534,10.865,72.863,73.727,108.183,211.49C358.93,284.736,355.281,288.143,348.931,292.215z"/>
                    </svg>`;
                    }
                    if (svg_con === 'heels' ){
                        svgContent = `<svg fill="${color}" height="400px" width="400px" version="1.1" id="Capa_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" 
                        viewBox="0 0 418.321 418.321" xml:space="preserve">
                    <path d="M362.383,251.467c-22.38-3.646-38.804-9.41-38.967-9.468c-1.747-0.619-3.689-0.219-5.048,1.026
                        c-2.055,1.567-15.89,8.986-36.342,8.986c-23.951,0-47.718-9.771-70.641-29.044C151,172.201,33.845,97.894,32.669,97.15
                        c-1.155-0.731-2.56-0.958-3.884-0.627c-1.326,0.331-2.459,1.19-3.135,2.377C-17.472,174.639,6.554,208.119,7.707,209.418
                        c8.301,9.351,30.392,31.98,29.678,107.23c-0.013,1.377,0.407,2.725,1.352,3.727c0.945,1.004,2.261,1.572,3.639,1.572h21.151
                        c2.761,0,5-2.238,5-5v-57.315c0-11.951,2.692-19.954,8.067-23.694c7.482-5.207,17.073-1.329,17.248-1.287
                        c49.496,20.598,84.914,58.082,84.914,58.082c12.919,13.211,37.567,28.957,81.625,28.957c57.96,0,150.183-21.592,154.08-22.512
                        c2.211-0.521,3.792-2.467,3.851-4.738C418.912,271.266,389.741,255.919,362.383,251.467z M58.527,259.632v52.315H47.554
                        c0.311-16.275-0.789-65.707-23.419-98.335c17.076,3.239,33.322,7.541,48.719,12.885C72.202,226.862,58.527,232.369,58.527,259.632z
                        M260.382,311.69c-40.58,0-62.899-14.111-74.477-25.949c0,0-19.436-21.779-52.04-41.582c-35.038-21.28-71.622-34.462-119.088-42.335
                        c-1.529-2.942-14.776-33.387,17.003-93.38c22.009,14.096,119.978,77.46,173.171,122.179c24.774,20.828,50.707,31.39,77.076,31.39
                        c19.572,0,34.309-6.123,40.459-9.778c5.487,1.781,19.802,6.092,38.29,9.103c21.518,3.503,44.088,14.643,47.185,29.07
                        C388.996,294.678,310.309,311.69,260.382,311.69z"/>
                    </svg>`;
                    }
                    if (svg_con === 'jacket' ){
                    svgContent = `<svg fill="${color}"height="400px" width="400px" version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" 
                        viewBox="0 0 512 512" xml:space="preserve">
                    <g>
                        <g>
                            <path d="M464.932,213.02c7.439-41.37,5.48-95.992-12.892-117.327c-17.325-20.121-66.121-38.28-79.168-42.879l-19.465-38.928
                                C349.126,5.321,340.517,0,330.941,0H181.058c-9.575,0-18.185,5.321-22.467,13.885l-19.465,38.929
                                c-13.047,4.598-61.843,22.758-79.168,42.879c-18.372,21.335-20.331,75.957-12.891,117.327c-2.235,9.554-11.871,55.029-3.075,94.92
                                c-0.506,7.686-3.135,49.172-2.111,64.388c0.853,12.664,4.765,23.667,11.218,32.256l-0.986,31.318
                                c-0.443,9.887,4.98,19.135,13.83,23.576c0.1,0.051,0.203,0.099,0.306,0.146l62.016,27.899v7.91
                                c0,9.136,7.432,16.568,16.568,16.568h222.33c9.136,0,16.568-7.432,16.568-16.568v-7.91l62.017-27.9
                                c0.104-0.047,0.204-0.095,0.306-0.146c8.872-4.451,14.299-13.733,13.826-23.675l-1.56-30.472
                                c6.796-8.693,10.919-19.965,11.796-33.001c1.024-15.216-1.605-56.702-2.111-64.388
                                C476.803,268.049,467.167,222.574,464.932,213.02z M449.225,209.713l-43.596,18.11c-1.164-5.299-2.722-10.684-4.795-16.09v-32.646
                                c0.018-1.529,0.933-36.527,42.894-66.964C453.271,131.091,455.854,172.448,449.225,209.713z M433.201,99.962
                                c-47.818,35.325-48.399,77.237-48.399,79.078v26.188H264.016v-79.486c44.363-10.122,91.537-46.563,104.797-57.365
                                C384.971,74.118,416.563,86.945,433.201,99.962z M387.085,306.772c3.494,11.296,10.447,40.02,2.312,69.478H264.016v-69.478
                                H387.085z M264.016,290.739v-69.478h123.185c9.785,29.31,3.234,58.145-0.155,69.478H264.016z M339.219,21.576
                                c0.022-0.029,0.041-0.059,0.063-0.089l17.847,35.693c-13.82,11.041-55.044,42.094-93.113,52.073V89.4
                                C275.528,81.938,310.137,57.93,339.219,21.576z M143.185,68.377c13.261,10.803,60.433,47.242,104.796,57.364v79.486H127.198
                                V179.04c0-1.841-0.581-43.753-48.398-79.077C95.43,86.958,127.025,74.125,143.185,68.377z M68.27,112.123
                                c41.962,30.437,42.877,65.434,42.894,66.917v32.693c-2.073,5.406-3.632,10.792-4.795,16.09l-43.596-18.11
                                C56.145,172.447,58.727,131.091,68.27,112.123z M60.739,226.228l43.205,17.948c-2.032,25.58,4.103,46.902,6.709,54.571
                                c-1.408,4.089-3.866,12.095-5.672,22.561L59.19,302.286C53.571,274.225,57.761,242.541,60.739,226.228z M57.879,371.25
                                c-0.711-10.558,0.573-36.305,1.456-51.543l43.693,18.151c-0.889,14.091,0.089,30.441,5.389,46.996
                                c-0.887,5.076-3.12,18.581-4.07,30.878L79.285,405.32C62.178,398.214,58.53,380.924,57.879,371.25z M73.007,445.081
                                c-3.134-1.634-5.043-4.95-4.874-8.489c0.002-0.043,0.003-0.085,0.004-0.128l0.581-18.465c1.429,0.767,2.888,1.494,4.414,2.128
                                l31.276,12.993c1.5,11.031,6.357,21.221,14.061,29.245c2.451,2.553,5.122,4.806,7.966,6.753L73.007,445.081z M247.983,495.967
                                H144.835c-0.295,0-0.534-0.241-0.534-0.534V476.73c3.367,0.701,6.833,1.066,10.362,1.066h93.321V495.967z M247.983,461.762
                                h-93.321c-19.47,0-34.721-15.811-34.721-35.996c0-10.189,2.128-25.022,3.492-33.482h124.55V461.762z M247.983,376.251H122.602
                                c-8.088-29.348-1.152-58.159,2.325-69.478h123.056V376.251z M247.983,290.739h-123.03c-3.392-11.343-9.939-40.173-0.156-69.478
                                h123.186V290.739z M247.983,109.252c-38.027-9.976-79.283-41.035-93.112-52.074l17.845-35.689c0.022,0.029,0.041,0.06,0.064,0.089
                                c29.082,36.354,63.692,60.362,75.203,67.823V109.252z M188.972,16.033h134.053c-26.014,31.039-56.202,52.302-67.03,59.435
                                C245.174,68.348,215.035,47.136,188.972,16.033z M367.699,495.432c0,0.294-0.241,0.534-0.534,0.534H264.016v-18.171h93.322
                                c3.528,0,6.995-0.365,10.361-1.066V495.432z M357.338,461.762h-93.322v-69.478h124.55c1.364,8.456,3.492,23.279,3.492,33.482
                                C392.058,445.951,376.807,461.762,357.338,461.762z M438.992,445.081l-53.432,24.038c2.845-1.948,5.517-4.201,7.969-6.754
                                c7.703-8.024,12.562-18.214,14.061-29.245l31.275-12.992c1.399-0.581,2.743-1.239,4.061-1.931l0.942,18.398
                                C444.035,440.131,442.126,443.447,438.992,445.081z M454.119,371.25c-0.65,9.673-4.298,26.964-21.405,34.07l-25.062,10.412
                                c-0.95-12.299-3.184-25.802-4.071-30.878c5.301-16.555,6.279-32.905,5.39-46.996l43.693-18.151
                                C453.547,334.944,454.831,360.689,454.119,371.25z M452.81,302.286l-45.791,19.022c-1.805-10.467-4.264-18.473-5.672-22.561
                                c2.606-7.669,8.74-28.992,6.708-54.571l43.206-17.948C454.239,242.542,458.429,274.226,452.81,302.286z"/>
                        </g>
                    </g>
                    </svg>`;
                    }
                    if (svg_con === 'shorts' ){
                        svgContent = `<svg fill="${color}"  height="400px" width="400px" version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" 
                        viewBox="0 0 512 512" xml:space="preserve">
                    <g>
                        <g>
                            <path d="M511.922,456.027L480.03,129.135c-0.72-7.374-4.52-13.709-10.054-17.812V54.358c0-9.167-7.458-16.625-16.625-16.625
                                H58.649c-9.167,0-16.625,7.458-16.625,16.625v56.964c-5.536,4.103-9.335,10.438-10.054,17.812L0.078,456.027
                                c-0.455,4.658,1.088,9.317,4.232,12.784c3.145,3.466,7.632,5.455,12.313,5.455h190.575c12.323,0,22.772-8.816,24.846-20.963
                                l23.427-137.216c0.043-0.251,0.101-0.348,0.098-0.348c0.163-0.13,0.701-0.129,0.851-0.012c0,0.001,0.063,0.094,0.108,0.359
                                l23.427,137.215c2.073,12.147,12.522,20.964,24.846,20.964h190.575c4.681,0,9.168-1.989,12.313-5.455
                                C510.834,465.346,512.376,460.685,511.922,456.027z M464.017,130.699l9.853,100.984c-7.98-4.243-20.759-11.999-33.789-23.871
                                c-25.822-23.531-41.365-52.21-46.304-85.345h61.167C459.659,122.467,463.559,126.007,464.017,130.699z M58.112,54.358
                                c0-0.295,0.24-0.536,0.536-0.536h394.703c0.295,0,0.536,0.241,0.536,0.536v52.019H306.947V80.1c0-4.444-3.601-8.044-8.044-8.044
                                c-4.444,0-8.044,3.601-8.044,8.044v26.278h-69.716V80.1c0-4.444-3.602-8.044-8.044-8.044s-8.044,3.601-8.044,8.044v26.278H58.112
                                V54.358z M308.019,251.71c0,5.027-4.09,9.117-9.117,9.117s-9.117-4.09-9.117-9.117c0-5.027,4.09-9.117,9.117-9.117
                                S308.019,246.683,308.019,251.71z M222.214,251.71c0,5.027-4.09,9.117-9.117,9.117s-9.117-4.09-9.117-9.117
                                c0-5.027,4.09-9.117,9.117-9.117S222.214,246.683,222.214,251.71z M47.982,130.697c0.458-4.692,4.359-8.231,9.074-8.231h61.166
                                c-4.938,33.136-20.481,61.814-46.304,85.345c-13.029,11.873-25.809,19.629-33.789,23.872L47.982,130.697z M16.624,458.178
                                c-0.064,0-0.237,0-0.397-0.176c-0.16-0.176-0.143-0.346-0.136-0.412l20.21-207.158c1.812-0.757,9.149-3.958,19.099-10.105
                                l-21.211,217.85H16.624z M304.801,458.178c-4.458,0-8.237-3.189-8.987-7.583l-23.428-137.216
                                c-1.39-8.141-8.128-13.826-16.387-13.826s-14.998,5.686-16.388,13.826l-23.427,137.216c-0.75,4.394-4.529,7.583-8.987,7.583
                                H50.353L72.748,228.18c3.12-2.459,6.313-5.133,9.532-8.044c35.909-32.489,48.377-69.839,52.185-97.67h70.589v105.362
                                c-9.964,3.366-17.161,12.796-17.161,23.882c0,13.898,11.307,25.205,25.205,25.205s25.205-11.307,25.205-25.205
                                c0-11.085-7.197-20.515-17.161-23.882V122.466h69.716v105.362c-9.964,3.366-17.161,12.796-17.161,23.882
                                c0,13.898,11.307,25.205,25.205,25.205s25.205-11.307,25.205-25.205c0-11.085-7.197-20.515-17.161-23.882V122.466h70.594
                                c6.413,47.277,31.613,79.06,52.18,97.67c3.219,2.912,6.412,5.585,9.532,8.044l22.395,229.998H304.801z M495.773,458.002
                                c-0.159,0.176-0.332,0.176-0.397,0.176h-17.564L456.6,240.327c9.948,6.146,17.284,9.347,19.099,10.105l20.21,207.159
                                C495.916,457.655,495.932,457.826,495.773,458.002z"/>
                        </g>
                    </g>
                    </svg>`;
                    }
                    if (svg_con === 'other') {
                    svgContent = `<svg fill="${color}" width="400px" height="400px" viewBox="0 -15.14 67.165 67.165" xmlns="http://www.w3.org/2000/svg">
                        <g id="hanger" transform="translate(-272.667 -36.807)">
                            <path id="Path_45" d="M306.25,54.779l-30.425,12.91s-3.586,2.488,0,4.512h30.424" fill="none" stroke="currentColor" stroke-miterlimit="10" stroke-width="3"/>
                            <path id="Path_46" d="M306.25,54.779l30.424,12.91s3.587,2.488,0,4.512H306.25" fill="none" stroke="currentColor" stroke-miterlimit="10" stroke-width="3"/>
                            <path id="Path_47" d="M306.322,54.205V50.6a2.241,2.241,0,0,1,1.3-2.385c1.556-.583,3.174-1.1,3.174-3.173V42.266a3.786,3.786,0,0,0-3.958-3.959c-4.072,0-4.664,4.663-4.664,4.663" fill="none" stroke="currentColor" stroke-linecap="round" stroke-miterlimit="10" stroke-width="3"/>
                        </g>
                    </svg>`;
                }


                    //other cases
                    if (svg_con === 'top_svg' ){
                        svgContent = `<svg fill="${color}" height="400px" width="400px" version="1.1" id="Capa_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" 
                        viewBox="0 0 399.199 399.199" xml:space="preserve">
                    </g>
                        </g>
                    <path d="M354.334,118.897c-11.729-51.721-25.311-75.372-25.311-75.372C301.385,18.658,256.984,1.211,254.81,0.351
                        c-1.539-0.609-3.279-0.417-4.65,0.515c-0.379,0.258-11.037,10.668-50.561,10.668h-0.002l0,0c-39.627,0-50.223-10.439-50.561-10.668
                        c-1.371-0.932-3.113-1.124-4.65-0.515C142.213,1.21,94.488,18.658,70.17,43.522c-0.762,0.779-13.578,23.654-25.307,75.375
                        c-10.734,47.333-22.34,129.157-16.695,250.19v25.111c0,2.76,2.238,5,5,5h45.336c2.416,0,4.486-1.729,4.918-4.105l4.568-25.082
                        l9.141-38.57c1.355,5.461,2.895,10.711,4.635,15.709l4.525,25.914c0.418,2.393,2.496,4.141,4.926,4.141H287.98
                        c2.43,0,4.508-1.748,4.926-4.141l4.525-25.914c1.74-4.998,3.279-10.248,4.635-15.711l9.139,38.572l4.568,25.082
                        c0.434,2.377,2.504,4.105,4.92,4.105h45.338c2.762,0,5-2.24,5-5v-25.111C376.676,248.054,365.068,166.23,354.334,118.897z
                        M199.597,21.533L199.597,21.533h0.002c23.824,0,38.176-3.4,46.559-6.779c-5.727,15.147-24.424,26.286-46.559,26.286h-0.002l0,0
                        c-22.135,0-40.832-11.139-46.557-26.286C161.424,18.133,175.773,21.533,199.597,21.533z M210.361,50.254l-10.764,11.517
                        l-10.762-11.517c3.488,0.515,7.086,0.786,10.762,0.786l0,0h0.002C203.275,51.04,206.871,50.769,210.361,50.254z M74.332,389.199
                        H38.168v-15.215h38.934L74.332,389.199z M94.793,126.687c-4.342,47.976-11.029,121.925-2.295,180.933L79.14,363.984H37.947
                        c-5.066-116.893,6.127-196.08,16.498-242.118c8.771-38.941,18.416-61.26,22.438-69.556c6.85,3.216,20.727,12.565,20.727,35.573
                        C97.609,95.57,96.367,109.302,94.793,126.687z M115.418,367.204l-2.842-16.287h174.045l-2.844,16.287H115.418z M296.705,306.87
                        c-0.018,0.086-4.371,23.752-7.721,34.047H110.213c-3.35-10.291-7.703-33.963-7.723-34.06c-8.717-57.789-2.057-131.547,2.262-179.268
                        c1.596-17.636,2.857-31.567,2.857-39.706c0-25.794-14.723-38.092-24.143-43.32c16.563-13.689,45.807-26.953,58.471-32.365
                        c2.756,13.782,13.293,25.549,27.938,32.412l26.07,27.899c0.984,1.054,2.318,1.586,3.654,1.586c1.223,0,2.449-0.446,3.414-1.347
                        c0.084-0.079,26.307-28.139,26.307-28.139c14.646-6.862,25.184-18.631,27.939-32.413c12.662,5.41,41.9,18.667,58.471,32.365
                        c-9.42,5.228-24.141,17.527-24.141,43.321c0,8.139,1.26,22.068,2.855,39.704C298.765,175.311,305.426,249.077,296.705,306.87z
                        M361.031,389.199h-36.166l-2.771-15.215h38.938V389.199z M361.25,363.984h-41.195l-13.355-56.367
                        c8.736-59.006,2.047-132.956-2.295-180.93c-1.572-17.385-2.814-31.116-2.814-38.803c0-23.015,13.885-32.363,20.721-35.573
                        C331.474,71.278,369.935,163.781,361.25,363.984z"/>
                    </g>
                </g>
                    </svg>`;
                    }
                    if (svg_con === 'bottom_svg' ){
                        svgContent = `<svg fill="${color}" height="400px" width="400px" version="1.1" id="Capa_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" 
                    viewBox="0 0 432.584 432.584" xml:space="preserve">
                <g>
                    <path d="M283.775,3.542c-0.425-1.394-1.436-2.532-2.77-3.119c-1.335-0.586-2.856-0.563-4.171,0.066
                        c-11.841,5.662-47.653,7.326-60.544,7.492c-12.89-0.164-48.694-1.824-60.542-7.492c-1.314-0.629-2.837-0.652-4.17-0.066
                        c-1.334,0.587-2.345,1.726-2.77,3.119c-0.777,2.549-18.959,62.946-12.816,108.417c3.011,22.283,8.282,49.747,12.933,73.978
                        c4.65,24.226,9.042,47.107,9.79,57.935c0.472,6.828,0.018,15.687-0.507,25.944c-1.108,21.666-2.488,48.63,4.209,73.326
                        c9.296,34.279,8.214,76.742,8.214,76.789c0,7.331,8.42,12.652,20.021,12.652c11.602,0,20.021-5.321,20.021-12.652
                        c0-0.085-2.486-49.781-0.029-72.571c1.723-15.967,0.938-36.739,0.366-51.906c-0.269-7.128-0.501-13.283-0.344-16.229
                        c0.079-1.487,0.233-3.992,0.438-7.302c1.085-17.578,3.627-58.742,3.627-89.832c0-14.243,0.65-28.984,1.558-41.779
                        c0.907,12.795,1.558,27.536,1.558,41.779c0,29.252,2.564,71.977,3.658,90.221c0.188,3.133,0.33,5.506,0.405,6.913
                        c0.157,2.945-0.075,9.101-0.344,16.229c-0.572,15.167-1.356,35.939,0.365,51.906c2.458,22.79-0.028,72.486-0.028,72.571
                        c0,7.331,8.42,12.652,20.022,12.652c11.603,0,20.023-5.321,20.023-12.652c0-0.047-1.083-42.51,8.213-76.789
                        c6.696-24.696,5.316-51.66,4.208-73.326c-0.525-10.258-0.979-19.116-0.507-25.944c0.748-10.829,5.142-33.717,9.792-57.947
                        c4.65-24.227,9.921-51.686,12.933-73.966C302.733,66.488,284.552,6.091,283.775,3.542z M283.664,47.913
                        c-5.492,0.088-14.326-0.664-20.674-5.589c-3.456-2.681-5.763-6.262-6.986-10.864c11.198-1.311,18.899-2.973,23.546-4.196
                        C280.917,33.294,282.365,40.315,283.664,47.913z M277.215,17.521c-7.496,1.979-25.334,5.625-55.92,6.016v-5.667
                        c11.263-0.335,38.85-1.614,54.361-6.298C276.101,13.208,276.632,15.221,277.215,17.521z M221.295,33.538
                        c2.089-0.025,4.117-0.066,6.094-0.12v35.525c0,7.325-3.075,11.242-6.094,13.325V33.538z M156.928,11.572
                        c15.507,4.681,43.1,5.962,54.367,6.297v5.667c-30.586-0.391-48.428-4.035-55.926-6.015
                        C155.952,15.222,156.483,13.209,156.928,11.572z M153.034,27.265c4.646,1.223,12.348,2.885,23.544,4.195
                        c-1.223,4.602-3.529,8.184-6.985,10.864c-6.346,4.923-15.18,5.677-20.673,5.589C150.219,40.316,151.667,33.294,153.034,27.265z
                        M204.734,182.092c0,30.781-2.528,71.731-3.608,89.216c-0.206,3.347-0.363,5.881-0.443,7.385c-0.182,3.4,0.048,9.463,0.337,17.139
                        c0.561,14.861,1.329,35.214-0.315,50.457c-2.439,22.626-0.314,67.994-0.045,73.429c-0.703,0.941-4.203,2.867-10.005,2.867
                        c-5.828,0-9.334-1.943-10.014-2.88c0.107-4.569,0.754-44.795-8.57-79.179c-6.28-23.158-4.945-49.24-3.873-70.198
                        c0.541-10.579,1.009-19.716,0.496-27.145c-0.79-11.43-5.033-33.535-9.945-59.13c-4.626-24.104-9.87-51.424-12.844-73.434
                        c-2.233-16.526-0.967-35.525,1.459-52.738c0.712,0.027,1.481,0.045,2.304,0.045c7.018,0,17.693-1.242,26.005-7.661
                        c5.64-4.356,9.306-10.339,10.947-17.822c7.137,0.574,15.338,0.98,24.676,1.096V97.66l-13.556,2.092
                        c-2.729,0.421-4.6,2.975-4.179,5.704c0.381,2.471,2.513,4.138,4.936,4.238c1.213,0.051,11.176-1.666,11.176-1.666
                        C206.873,124.103,204.734,157.458,204.734,182.092z M286.68,110.619c-2.975,22.006-8.217,49.321-12.843,73.421
                        c-4.914,25.601-9.158,47.711-9.948,59.143c-0.513,7.429-0.045,16.565,0.496,27.145c1.072,20.958,2.407,47.04-3.873,70.198
                        c-9.323,34.384-8.676,74.609-8.568,79.179c-0.681,0.936-4.187,2.88-10.016,2.88c-5.802,0-9.302-1.926-10.005-2.867
                        c0.269-5.436,2.395-50.803-0.045-73.429c-1.645-15.243-0.877-35.597-0.315-50.457c0.289-7.676,0.518-13.738,0.337-17.139
                        c-0.076-1.42-0.22-3.816-0.409-6.979c-1.09-18.154-3.641-60.669-3.641-89.621c0-24.637-2.14-57.989-4.939-74.063
                        c0,0,9.708,1.755,11.176,1.666c2.42-0.146,4.555-1.768,4.936-4.238c0.421-2.73-1.449-5.283-4.179-5.704l-13.548-2.091v-4.249
                        c7.14-2.546,16.094-9.577,16.094-24.469V33.017c3.014-0.163,5.871-0.356,8.574-0.574c1.643,7.483,5.309,13.467,10.949,17.823
                        c8.313,6.419,18.986,7.66,26.004,7.66c0.822,0,1.592-0.018,2.305-0.046C287.647,75.094,288.913,94.093,286.68,110.619z"/>
                </g>
                </svg>`;
                    }
                    if (svg_con === 'footwear_svg' ){
                        svgContent = `<svg fill="${color}" height="400px" width="400px" version="1.1" id="_x32_" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" 
                        viewBox="0 0 512 512"  xml:space="preserve">
                    <g>
                        <path class="st0" d="M512,294.114c0-7.68-1.45-15.866-5.332-23.63c-3.851-7.755-10.164-14.952-19.046-20.344
                            c-7.794-4.758-21.356-11.645-38.454-20.066c-25.586-12.573-58.754-28.251-89.354-43.174c-15.3-7.438-29.936-14.711-42.653-21.251
                            c-12.688-6.548-23.456-12.415-30.797-16.932c-14.47-8.88-26.93-13.064-38.061-13.102c-5.694-0.008-10.996,1.163-15.602,3.406
                            c-6.948,3.353-12.008,9.002-15.058,15.24c-3.096,6.261-4.41,13.141-4.426,19.99c0,22.187,0,30.11,0,38.038
                            c0.031,2.583,0.258,4.464,0.242,5.793c0,1.163-0.136,1.745-0.211,1.858l-0.152,0.219c-0.257,0.249-1.344,1.103-4.38,1.873
                            c-3.006,0.77-7.748,1.36-14.514,1.352c-33.289,0-96.679,0-112.523,0c-8.503,0-14.953-1.035-19.967-2.455
                            c-7.538-2.182-11.962-5.128-15.935-8.034c-2.009-1.466-3.836-2.976-6.193-4.456c-1.193-0.732-2.522-1.472-4.153-2.084
                            c-1.601-0.589-3.55-1.027-5.618-1.027c-3.671-0.031-7.144,1.396-9.788,3.254c-2.703,1.881-4.954,4.184-7.431,7.076
                            c-5.136,6.125-8.066,13.669-9.969,21.832C0.755,245.662,0,254.572,0,263.643c0,12.188,1.39,24.679,3.655,35.871
                            c2.009,9.696,4.622,18.23,7.96,25.178l2.976,51.692h167.757l3.05-10.746l36.052,10.746h277.017l2.054-6.736
                            c0.77-2.53,1.299-5.226,1.752-8.194c1.358-8.813,1.933-19.922,1.948-28.592c-0.014-3.035-0.106-5.566-0.287-7.892
                            c1.949-3.315,3.61-7.046,4.954-11.207C510.791,307.851,512,301.175,512,294.114z M484.436,350.398
                            c-0.211,2.507-0.498,4.848-0.785,6.963H224.214l-51.836-15.451l-4.396,15.451H32.533l-1.586-27.79h454.214
                            c0.03,1.027,0.045,2.122,0.045,3.292C485.206,338.036,484.949,344.508,484.436,350.398z M490.779,307.95
                            c-1.193,3.768-2.809,6.94-4.198,8.941H28.863c-2.311-4.705-4.803-12.408-6.57-21.182c-2.024-9.924-3.278-21.327-3.278-32.065
                            c0-7.983,0.71-15.61,2.16-21.901c1.404-6.306,3.655-11.154,5.95-13.804c1.208-1.45,2.19-2.417,2.885-3.021
                            c0.786,0.52,1.888,1.322,3.262,2.371c3.67,2.772,9.213,6.789,17.082,9.855c7.884,3.104,18.079,5.264,31.325,5.264
                            c15.844,0,79.234,0,112.523,0c6.947-0.015,12.581-0.506,17.384-1.526c3.61-0.755,6.752-1.827,9.561-3.323
                            c4.184-2.182,7.552-5.664,9.289-9.44c1.767-3.776,2.039-7.348,2.039-10.036c-0.016-2.749-0.242-4.856-0.226-5.793
                            c0-7.929,0-15.851,0-38.038c-0.016-5.822,1.616-11.108,4.168-14.341c1.284-1.654,2.734-2.87,4.576-3.776
                            c1.858-0.891,4.154-1.495,7.311-1.495c6.102-0.038,15.541,2.522,28.093,10.278c10.784,6.63,26.839,15.088,45.522,24.49
                            c28.017,14.077,61.804,30.154,91.257,44.337c14.71,7.09,28.349,13.706,39.586,19.34c11.207,5.619,20.103,10.324,24.936,13.276
                            c5.996,3.686,9.606,7.952,11.947,12.62c2.326,4.659,3.338,9.855,3.338,15.134C492.999,298.94,492.124,303.78,490.779,307.95z
                            M493.755,323.302v-0.076l0.076,0.068L493.755,323.302z"/>
                    </g>
                    </svg>`;
                    }

    // Determine weather suitability, coverage and practicality
    const weather_suitability = determineWeatherSuitability(name);
    const { coverage, practicality } = determineCoverageAndPracticality({ name, weather_suitability });

    const userId =req.session.user_id;
    console.log("user id ", userId);

    console.log('Inserting into DB:', { name, category, color, weather_suitability, coverage, practicality, svgContent, userId});
    db.run('INSERT INTO clothes (name, category, color, weather_suitability, coverage, practicality, svg, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [name, category, color, weather_suitability, coverage || 1, practicality || 1 , svgContent, userId],
        function (err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ id: this.lastID, name, category, color, weather_suitability, coverage, practicality, svgContent, user_id: userId});
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
    const userId = req.session.user_id;

    db.all(`
        SELECT lookbook.id, lookbook.date, clothes.name, clothes.category, clothes.color, clothes.svg
        FROM lookbook
        JOIN clothes ON lookbook.clothing_id = clothes.id
        WHERE lookbook.user_id = ?`, [userId], (err, rows) => {
            if(err) return res.status(500).json ({error: err.message});
            res.json(rows);
        });
});

app.post ('/lookbook',(req, res) => {
    const userId = req.session.user_id;
    const {clothing_id, date} = req.body;
    db.run ("INSERT INTO lookbook (clothing_id, user_id, date) VALUES (?, ?, ?)", [clothing_id, userId, date], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, clothing_id, userId, date });
    });

});

//Analytics calls
app.get ('/analytics',async (req, res) => {
    const userId = req.session.user_id;
    try {
        const mostWorn = await new Promise((resolve, reject) => {
            db.all(
                `SELECT c.id, c.name, c.category, c.color, COUNT(l.clothing_id) AS count
                FROM lookbook l
                JOIN clothes c ON l.clothing_id = c.id
                WHERE c.user_id = ?
                GROUP BY l.clothing_id
                ORDER BY count DESC
                LIMIT 5;`, [userId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });

        const leastWorn = await new Promise((resolve, reject) => {
            db.all(
                `SELECT c.id,c.name, c.category, c.color, COUNT(l.clothing_id) AS count
                FROM clothes c
                LEFT JOIN lookbook l ON c.id = l.clothing_id
                WHERE c.user_id = ?
                GROUP BY c.id
                ORDER BY count ASC
                LIMIT 5;`,[userId],
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

//Donations calls
app.post("/donate", (req, res) => {
    const { id } = req.body;
    const userId = req.session.user_id;

    if (!id) {
        return res.status(400).json({ success: false, error: "Missing clothing ID" });
    }

    db.get("SELECT * FROM clothes WHERE id = ? AND user_id = ?", [id, userId], (err, item) => {
        if (err) {
            console.error("Error fetching clothing item:", err);
            return res.status(500).json({ success: false, error: "Database error" });
        }

        if (!item) {
            console.log("Clothing item not found for ID:", id);
            return res.status(404).json({ success: false, error: "Clothing item not found" });
        }

        console.log("Fetched item details:", item);

        db.run(
            "INSERT INTO donations (clothing_id, name, category, color, weather_suitability,coverage, practicality, donated_date, svg, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ? )",
            [id, item.name, item.category, item.color, item.weather_suitability, item.coverage, item.practicality, new Date(), item.svg, userId],
            function (err) {
                if (err) {
                    console.error("Error inserting into donations:", err.message);
                    return res.status(500).json({ success: false, error: err.message });
                }
                

                db.run("DELETE FROM clothes WHERE id = ?", [id], function (err) {
                    if (err) {
                        console.error("Error deleting from clothes table:", err.message);
                        return res.status(500).json({ success: false, error: err.message });
                    }

                    console.log("Clothing item donated and removed from clothes table");
                    return res.json({ success: true });
                });
            }
        );
    });
});




app.get("/donated-clothes", (req, res) => {
    const userId = req.session.user_id;
    db.all(
        `SELECT d.id, d.clothing_id, d.name, d.category, d.color, d.weather_suitability, d.coverage , d.practicality, d.donated_date, d.svg, d.user_id 
         FROM donations d 
         WHERE d.user_id = ?
         `, 
        [userId], 
        (err, rows) => {
            if (err) return res.json({ success: false, error: err.message });
            res.json(rows);
        }
    );
});
app.post('/reclaim', (req, res) => {
    const { id } = req.body;

    console.log("Reclaim request received for ID:", id);

    // Get the donated item details
    const getItemQuery = `SELECT * FROM donations WHERE id = ?`;
    db.get(getItemQuery, [id], (err, item) => {
        if (err) {
            console.error("Error retrieving item:", err);
            return res.status(500).json({ success: false, error: "Database error" });
        }

        if (!item) {
            return res.status(404).json({ success: false, error: "Item not found in donations" });
        }

        const insertQuery = `INSERT INTO clothes (name, category, color, weather_suitability, coverage, practicality, donated, svg, user_id) 
                             VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`;

        db.run(insertQuery, [item.name, item.category, item.color, item.weather_suitability, item.coverage, item.practicality, item.svg, item.user_id], function(err) { 
            if (err) {
                console.error("Error inserting back into clothes:", err);
                return res.status(500).json({ success: false, error: "Failed to reclaim item" });
            }

            console.log(`Item reclaimed successfully as new entry with ID ${this.lastID}`);

            // Remove it from donations
            const deleteQuery = `DELETE FROM donations WHERE id = ?`;
            db.run(deleteQuery, [id], function(err) {
                if (err) {
                    console.error("Error deleting from donations:", err);
                    return res.status(500).json({ success: false, error: "Failed to remove from donations" });
                }

                console.log(`Item with ID ${id} successfully reclaimed.`);
                
                res.json({ success: true, message: "Item reclaimed successfully" });
            });
        });
    });
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
    db.run('DELETE FROM clothes WHERE id = ?', [id], function (err) {
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
