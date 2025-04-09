//coverage and practicality nlp
const natural = require('natural');
const classifier = new natural.BayesClassifier();

classifier.addDocument('jacket coat hoodie fleece boots', 'high');
classifier.addDocument('jumper sweater', 'medium-high');
classifier.addDocument('t-shirt top', 'medium');
classifier.addDocument('jeans pants', 'medium');
classifier.addDocument('sandals trainers', 'low');


classifier.addDocument('cold winter snow', 'high');
classifier.addDocument('rain waterproof', 'medium-high');
classifier.addDocument('windy breeze', 'medium');
classifier.addDocument('hot summer sun', 'low');


classifier.train();

function determineCoverageAndPracticality(item) {
    let words = item.name.toLowerCase().split(" ");

    let coverage = classifier.classify(words.join(" "));
    let practicality = classifier.classify(item.weatherSuitability || "");

    const coverageLevels = { "high": 5, "medium-high": 4, "medium": 3, "low": 2 };
    const practicalityLevels = { "high": 5, "medium-high": 4, "medium": 3, "low": 2 };

    return {
        ...item,
        coverage: coverageLevels[coverage] || 1, 
        practicality: practicalityLevels[practicality] || 1
    };
}

module.exports = determineCoverageAndPracticality;
