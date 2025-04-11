//simple clustering with kmeans before experimentation
const ml = require('ml-kmeans');

function clusterOutfits(clothingItems, numClusters = 3) {

    const categoryItems = clothingItems.filter(item =>
        item.category === 'top' || item.category === 'bottoms' || item.category === 'footwear'
    );

    if (categoryItems.length === 0) return [];

    const features = categoryItems.map(item => [
        item.coverage || 1,      
        item.practicality || 1   
    ]);

    const uniqueValues = new Set(features.map(f => f.toString()));
    if (uniqueValues.size === 1) {
        return categoryItems.map((item, index) => ({ ...item, cluster: index % numClusters }));
    }

    const { clusters } = ml.kmeans(features, Math.min(numClusters, categoryItems.length));

    return categoryItems.map((item, index) => ({ ...item, cluster: clusters[index] }));
}

// Function for outfit recommendation
function getOutfitRecommendation(clothingItems, weatherSuitability) {
    console.log("Raw clothing items:", clothingItems); 
    console.log("Weather suitability:", weatherSuitability);
   
    const clusteredItems = clusterOutfits(clothingItems, 3);
    console.log("Clustered clothing items:", clusteredItems);
    
    const tops = clusteredItems.filter(item => item.category === 'top');
    const bottoms = clusteredItems.filter(item => item.category === 'bottoms');
    const footwear = clusteredItems.filter(item => item.category === 'footwear');

    const getRandomItem = (items) => items.length > 0 ? items[Math.floor(Math.random() * items.length)] : null;

    return {
        top: getRandomItem(tops),
        bottoms: getRandomItem(bottoms),
        footwear: getRandomItem(footwear)
    };
}

module.exports = { clusterOutfits, getOutfitRecommendation };

 // Filter by weather suitability
    // const weatherItems = clothingItems.filter(item =>
    //     item.weatherSuitability === weatherSuitability
    // );
    //console.log("Filtered clothing items based on weather suitability:", weatherItems);