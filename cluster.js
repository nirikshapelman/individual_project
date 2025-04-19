const ml = require('ml-kmeans');
const { PCA } = require('ml-pca');

// Clustering function
function clusterOutfits(clothingItems, numClusters = 3) {
    const categoryItems = clothingItems.filter(item =>
        item.category === 'top' || item.category === 'bottoms' || item.category === 'footwear'
    );

    if (categoryItems.length === 0) return [];

    const colorItems = {
        red: [255, 0, 0],
        blue: [0, 0, 255],
        green: [0, 128, 0],
        black: [0, 0, 0],
        white: [255, 255, 255],
        pink: [255, 192, 203],
        brown: [165, 42, 42],
        purple: [128, 0, 128],
        beige:[245, 245, 220]
      };

      const rawFeatures = categoryItems.map (item =>{
        const rgb = colorItems[item.color] || [0,0,0];
        return [
            item.coverage || 1,
            item.practicality || 1,
          ...rgb 
        ];
      });
    
    //PCA
    const pca = new PCA(rawFeatures);
    const features = pca.predict(rawFeatures, {nComponents: 2}). to2DArray();
    
    console.log("PCA Features:");

    features.forEach((feature,index) =>{
        console.log(`Item ${index + 1}: PCA X = ${feature[0]}, PCA Y = ${feature[1]}`)
    });

    const uniqueValues = new Set(features.map(f => f.toString()));
    if (uniqueValues.size === 1) {
        return categoryItems.map((item, index) => ({ ...item, cluster: index % numClusters }));
    }
    //K-means
    const { clusters } = ml.kmeans(features, Math.min(numClusters, categoryItems.length));

    return categoryItems.map((item, index) => ({
        ...item,
        cluster: clusters[index]
    }))
}
//Sort Outfit Recommendations
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

