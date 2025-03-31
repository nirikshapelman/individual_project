//NLP
const natural = require('natural');
const classifier = new natural.BayesClassifier();
const tokenizer = new natural.WordTokenizer();

classifier.addDocument('t-shirt, tank, shorts, skirt, dress, sandals', 'hot');
classifier.addDocument('jacket, sweater, coat, hoodie, trousers, fleece, jeans, trainers, jumper, boots', 'cold');
classifier.addDocument('raincoat, waterproof, jacket, jumper, jeans, boots', 'rain');
classifier.addDocument('jacket, coat, hoodie, jumper, windbreaker', 'windy');
classifier.addDocument('jeans, trainers, t-shirt', 'all-weather');

classifier.train();

function determineWeatherSuitability(itemName){
    let words = tokenizer.tokenize(itemName.toLowerCase());
    let stemWords = words.map (word => natural.PorterStemmer.stem(word));
    // console.log("Item:", itemName);
    // console.log("Classified as:", classification);
    return classifier.classify(stemWords.join(" "));


}

module.exports = determineWeatherSuitability;