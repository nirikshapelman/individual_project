//NLP
const natural = require('natural');
const classifier = new natural.BayesClassifier();
const tokenizer = new natural.WordTokenizer();

classifier.addDocument('t-shirt, tank top, shorts, skirt, dress, sandals', 'hot');
classifier.addDocument('jacket, sweater, coat, hoodie, trousers, fleece, jeans, trainers, jumper, boots', 'cold');
classifier.addDocument('raincoat, waterproof, jacket, jumper, jeans, boots', 'rain');
classifier.addDocument('jacket, coat, hoodie, jumper, windbreaker', 'windy');
classifier.addDocument('jeans, trainers, t-shirt', 'all-weather');

classifier.train();

//Sort Weather Suitabilty
function determineWeatherSuitability(itemName){
    const words = tokenizer.tokenize(itemName.toLowerCase());
    const stemWords = words.map (word => natural.PorterStemmer.stem(word));
    // console.log("Item:", itemName);
    // console.log("Classified as:", classification);
    const text = stemWords.join (" ");

    const classifications = classifier.getClassifications(text);

    const threshold = 0.1; 
    const matchedLabels = classifications
        .filter(c => c.value >= threshold)
        .map(c => c.label);

    return matchedLabels.join(','); 


}

module.exports = determineWeatherSuitability;