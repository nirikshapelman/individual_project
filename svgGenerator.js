//generating images with svg
function loadandModify(item){
    const svgFile = `${item.n}.svg`;

    return fetch(svgFile)
        .then(response => response.text())
        .then(svgContent => {
            let parser = new DOMParser();
            let svgDoc = parser.parseFromString(svgContent, 'image/svg+xml');
            let clothingBody = svgDoc.querySelector(`#${item.name}-body`);

            if (clothingBody) {
                clothingBody.setAttribute('fill', item.color);
            } else {
                console.error('Could not find the body element in the SVG.');
            }

            const modifiedSVG = svgDoc.documentElement.outerHTML; 
            return modifiedSVG;
        })
        .catch(error => console.error('Error loading the SVG:', error));
}

export { loadandModify };