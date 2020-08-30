// var pkg_main   = require('users/kongdd/public:pkg_main.js');
var global_prop = ['system:id', 'system:time_start', 'system:time_end']; //, 'system:index'
var points = require('users/kongdd/public:data/flux_points.js').points;
/** ------------------------------------------------------------------------- */

var addYearProp = function(img) {
    return img.set('year', ee.Date(img.get('system:time_start')).get('year'));
};
var addDateProp = function(img) {
    return img.set('date', ee.Date(img.get('system:time_start')).format('yyyy-MM-dd'));
};

/** get values from image array or imgcol, clipped by region or regions */
function imgRegion(img, region, name){
    var val = ee.Image(img).reduceRegion({reducer:ee.Reducer.toList(), geometry:region, scale:500});
    // val = ee.List(val);
    print(name, val); //.get('L')
    return val;
}

function imgRegions(img, regions, name){
    var val = ee.Image(img).reduceRegions({
        collection:regions,
        reducer:ee.Reducer.toList(),
        scale:500, 
        tileScale:16
    })
    .map(function(f){
        var data = ee.List(f.get('list')); //.get(0)
        return ee.Feature(null).copyProperties(f, ['site'])
            .set('data', data);
    });
    
    if (name !== undefined){
        var keys   = val.aggregate_array('site');
        var values = val.aggregate_array('data');
        var dict   = ee.Dictionary.fromLists(keys, values);
        print(name, dict);
        // print(name, val);
    }
    return val;
}

function imgcolRegion(imgcol, region, name){
    var vals = ee.ImageCollection(imgcol).map(function(img){return imgRegion(img, region, name);});
    if (name !== undefined){
        print(name, vals);
    }
    return vals;
}

function imgcolRegions(imgcol, regions, name){
    var vals = ee.ImageCollection(imgcol).map(function(img){return imgRegions(img, regions, name);});
    if (name !== undefined){
        print(name, vals);
    }
    return vals;
}


/**
 * img_setDate
 * 
 * add properties, i.e., [system:time_start, system:time_end, system:id] to Image
 *           
 * @param {Image}   img  [description]
 * @param {ee.Date} date [description]
 */
function img_setDate(img, date) {
    date = ee.Date(date);
    return ee.Image(img)
        .set('system:time_start', date.millis())
        .set('system:index', date.format('YYYY_MM_dd'))
        .set('system:id', date.format('YYYY_MM_dd'));
        // .set('system:time_end', beginDate.advance(1, 'day').millis())
        // .set('system:id', beginDate.format('yyyy-MM-dd'));
}

var setImgProperties = img_setDate;


/**
 * Extract bitcoded QA information from a band and return it as an image.
 * @param {image} QAImage An image with a single bit packed quality assurance
 *     (QA) band.
 * @param {integer} start The position of the starting bit.
 * @param {integer} end The position of the ending bit.
 * @param {string} newName The name given to the new band.
 * @return {image} An image with the extracted QA parameter band.
 * 
 * @usage
 * pkg_main.getQABits(image, start, end)
 */
var getQABits = function(image, start, end, newName) {
    end     = end || start;
    newName = newName || "b1";
    // Compute the bits we need to extract.
    var pattern = 0;
    for (var i = start; i <= end; i++) {
       pattern += Math.pow(2, i);
    }
    return image.select([0], [newName])
                  .bitwiseAnd(pattern)
                  .rightShift(start);
};


/** 
 * qc2bands 
 * 
 * convert QC value to mutiple bands, only suit for 'SummaryQA'
 */
var qc2bands = function(img, band_qc){
    band_qc = band_qc || 'SummaryQA';
    var qc = img.select(band_qc); // missing value is ignored
    
    var good   = qc.updateMask(qc.eq(0)).rename('good');
    var margin = qc.updateMask(qc.eq(1)).rename('margin');
    var snow   = qc.updateMask(qc.eq(2)).rename('snow'); // snow or ice
    var cloud  = qc.updateMask(qc.eq(3)).rename('cloud');
    
    return ee.Image([good, margin, snow, cloud])
        .copyProperties(img, ['system:time_start']);
};

var pkg_main = {
    global_prop     : global_prop,
    addYearProp     : addYearProp,
    addDateProp     : addDateProp,
    setImgProperties: setImgProperties,
    img_setDate     : img_setDate,
    imgRegion       : imgRegion,
    imgRegions      : imgRegions,
    imgcolRegion    : imgcolRegion,
    imgcolRegions   : imgcolRegions,
    getQABits       : getQABits,
    qc2bands        : qc2bands,
};


pkg_main.seq_len = function(n) {
    return Array(n).join().split(',').map(function (e, i) { return i; });
};

pkg_main.seq = function(from, to, by) {
    by = by || 1;
    var res = [];
    for (var i = from; i <= to; i += by) { res.push(i); }
    return res;
};

pkg_main.array2dict = function(arr) {
    var res = {};
    for (var i = 0; i < arr.length; i++) {
        res[i] = arr[i];
    }
    return res;
};

pkg_main.is_empty_dict = function(x){
    return Object.keys(x).length === 0
};

pkg_main.imgcol_setProp = function (imgcol, probName, probs) {
    if (!probs) return imgcol;
    var n = imgcol.size();
    var lst = imgcol.toList(n);
    var res;
    if (probName === "date") {
        res = ee.List.sequence(0, n.subtract(1)).map(function (i) {
            // var prob = probs.get(i);
            var img = ee.Image(lst.get(i));
            var date = ee.Date(probs.get(i));
            return img.set('system:time_start', date.millis())
                .set('system:index', date.format('YYYY_MM_dd'))
                .set('system:id', date.format('YYYY_MM_dd'));
            // .set('id', date.format('YYYY_MM_dd'));
        });
    } else {
        res = ee.List.sequence(0, n.subtract(1)).map(function (i) {
            var prob = probs.get(i);
            var img = lst.get(i);
            return img.set(probName, prob);
        });
    }
    return ee.ImageCollection(res);
};

pkg_main.imgcol_setDate = function (imgcol, dates) {
    return pkg_main.imgcol_setProp(imgcol, 'date', dates);
};

/**
 * multiple bands image convert to image list
 * 
 * The bandName should be like that "b2003-01-01".
 * 
 * @param  {[type]} img      multiple bands image
 * @param  {[type]} bandname the new bandname
 * @return {ee.List}         List of images
 */
pkg_main.bands2imgcol = function(img, bandname) {
    bandname = bandname || "b1";
    img = ee.Image(img);
    var names = img.bandNames(); // ee.List
    var n = names.size();

    var imgcol_lst = names.map(function (name) {
        var date = ee.Date.parse('YYYY_MM_dd', ee.String(name).slice(1, 11));
        return img.select([name], [bandname])
            .set('system:time_start', date.millis())
            // .set('system:time_end', beginDate.advance(1, 'day').millis())
            .set('system:id', date.format('yyyy_MM_dd'))
            .set('system:index', date.format('yyyy_MM_dd'));
    });
    return imgcol_lst;
    // return ee.ImageCollection(imgcol_lst);
}

/**
 * [array2imgcol description]
 * 
 * Convert 2d ImageArray into imgcol
 *
 * @param  {[type]} mat   [description]
 * @param  {[type]} nrow  [description]
 * @param  {[type]} ncol  [description]
 * @param  {[type]} bands [description]
 * @param  {[type]} dates [description]
 * @return {[type]}       [description]
 */
pkg_main.array2imgcol = function (mat, dates, bands) {
    // var dates   = ee.List(imgcol.aggregate_array('system:time_start'));
    // var indices = ee.List(imgcol.aggregate_array('system:index'));
    mat = ee.Image(mat);
    // nrow = ee.Number(nrow);
    var nrow = dates.length();
    if (bands === undefined) {
        bands = ee.List.sequence(1, ncol).map(function (i) {
            return ee.String('iter').cat(ee.Number(i).int());
        }).getInfo();
    }
    var ncol = bands.length;

    var res = ee.List.sequence(0, nrow.subtract(1))
        .map(function (i) {
            i = ee.Number(i).int();
            var yi = mat.arraySlice(0, i, i.add(1));
            var img = yi.arrayProject([1]).arrayFlatten([bands]);
            var beginDate = ee.Date(dates.get(i));
            return pkg_main.img_setDate(img, beginDate);
            // return img;
        });
    // res = pkg_main.imgcol_setDate(ee.ImageCollection(res), dates);
    return ee.ImageCollection(res);
};

pkg_main.array2imgcol_1d = function (mat, dates, bandname) {
    bandname = bandname || "b1";
    var bands = dates.map(function (x) { return ee.String("b").cat(ee.Date(x).format("YYYY_MM_dd")) });
    var img = mat.arrayProject([1]).arrayFlatten([bands]); // multiple bands img
    var res = ee.ImageCollection(pkg_main.bands2imgcol(img));
    return res;
};

exports = pkg_main;
