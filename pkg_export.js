var pkg_export = {};
// var pkg_export = require('users/kongdd/public:pkg_export.js');

/**
 * Get exported image dimensions
 *
 * @param {array.<number>}     range     [lon_min, lat_min, lon_max, lat_max]
 * @param {double} cellsize  cellsize (in the unit of degree), used to calculate 
 * dimension.
 * 
 * @return {String} WIDTHxHEIGHT
 *
 * @example
 * pkg_export.getDimensions(range, cellsize)
 */
pkg_export.getDimensions = function (range, cellsize) {
    if (!range || !cellsize) return undefined;

    var step = cellsize; // degrees
    var sizeX = (range[2] - range[0]) / cellsize;
    var sizeY = (range[3] - range[1]) / cellsize;
    sizeX = Math.round(sizeX);
    sizeY = Math.round(sizeY);

    var dimensions = sizeX.toString() + 'x' + sizeY.toString(); //[sizeX, ]
    return dimensions;
};


/** Get projection info of ee.Image or ee.ImageCollection */
pkg_export.getProj = function(img){
    img = ee.ImageCollection(img).first();
    var prj = img.select(0).projection();
    var prj_dict = prj.getInfo();
    
    return {
        prj          : prj, 
        scale        : ee.Number(prj.nominalScale()).getInfo(),
        crs          : prj_dict.crs,
        crsTransform : prj_dict.transform
    };
};

/**
 * ExportImg
 *
 * @param {ee.Image} Image: The image to export.
 * @param {String}   task : The file name of exported image
 * @param {Dictionary} options
 * - `type`         : export type, one of 'asset', 'cloud' and 'drive'
 * - `range`        : [lon_min, lat_min, lon_max, lat_max]
 * - `cellsize`     : cellsize (in the unit of degree), used to calculate dimension.
 * - `folder`       : The Folder that the export will reside in. If  export type is cloud or asset, folder need to be absolute path.
 * - `crs`          : CRS to use for the exported image.
 * - `crsTransform` : Affine transform to use for the exported image. Requires "crs" to be defined.
 * - `scale`        : (number) Resolution in meters per pixel. Defaults to 1000.
 * - `dimensions`   : Takes either a single positive integer as the maximum dimension 
 *    or "WIDTHxHEIGHT" where WIDTH and HEIGHT are each positive integers.
 * - `verbose`      : boolean
 * 
 * @description
 * "region" and "dimensions" and either "crs_transform" or "scale" may not be specified together.
 * If `dimension` provided, scale will be ignored.
 *
 * # Some options to clip regional data
 * 1. crs + region + crsTransform    | √
 * 2. crs + region + dimensions      | √ (resample)
 * 3. crs + region + scale           | √
 * 
 * You must Can't (20191228):
 * 1. crsTransform and dimensions can't occur in the same time, error.
 * 2. crs + region  | resampled, unknown cellsize (scale = 1000), out of control (try to fix this situation)
 * 
 * @examples
 * ExportImg(Image, task, range, cellsize, type, folder, crs, crs_trans)
 */
// // examples
// // https://code.earthengine.google.com/235425776856f67349ffae2e1343f1ad
// var imgcol = ee.ImageCollection("MODIS/006/MCD12Q1");
// var pkg_export = require('users/kongdd/public:pkg_export2.js');
// var img = imgcol.first().select(0);
// var prj = pkg_export.getProj(imgcol);
// var options = {
//     type: "drive",
//     range: [95, 30, 120, 42], //[-180, -60, 180, 90],
//     cellsize: 1 / 240,
//     // crsTransform : [463.312716528, 0, -20015109.354, 0, -463.312716527, 10007554.677], // prj.crsTransform;
//     // scale        : 463.3127165275, // prj.scale
//     crs: 'EPSG:4326', // 'SR-ORG:6974', // EPSG:4326
//     folder: 'PMLV2'
// };
// pkg_export.ExportImg(img, "img_first", options);
// pkg_export.ExportImgCol(imgcol, null, options, 'MCD12Q1_06_');
pkg_export.ExportImg = function (Image, task, options) {
    // range, cellsize, type, folder, crs, crsTransform
    var bounds; // define export region

    var verbose = options.verbose;
    if (verbose === undefined) verbose = false;
    var range        = options.range || [-180, -60, 180, 90];
    var cellsize     = options.cellsize; //pkg_export.getProj(Image)['crsTransform'][0];
    var type         = options.type || 'drive';
    var folder       = options.folder || "";
    var crs          = options.crs || 'EPSG:4326'; //'SR-ORG:6974';
    var crsTransform = options.crsTransform;
    var dimensions   = options.dimensions || pkg_export.getDimensions(range, cellsize);
    var scale        = options.scale;

    function rm_slash(x) {
        if (x !== "" && x.substring(x.length - 1) === "/") 
            x = x.substring(0, x.length - 1);
        return x;
    }
    folder = rm_slash(folder);
    
    bounds = ee.Geometry.Rectangle(range, 'EPSG:4326', false); //pkg_export.get_bound(range);

    if (crsTransform) {
        dimensions = undefined;
        scale = undefined;
    } else {
        // If dimensions and crsTransform don't exist in the sometime，scale works
        if (!dimensions && !scale) scale = pkg_export.getProj(Image).scale;
        // print("debug", scale, dimensions)
    }
    if (dimensions) scale = undefined;

    // var crsTransform  = [cellsize, 0, -180, 0, -cellsize, 90]; //left-top
    var params = {
        image        : Image,
        description  : task,
        crs          : crs,
        crsTransform : crsTransform,
        region       : bounds,
        dimensions   : dimensions,
        scale        : scale,
        maxPixels    : 1e13
    };
    
    task = folder.concat('/').concat(task);
    switch (type) {
        case 'asset':
            params.assetId = task; //projects/pml_evapotranspiration/;
            Export.image.toAsset(params);
            break;
        case 'cloud':
            params.bucket = options.bucket;
            params.fileNamePrefix = task;
            params.skipEmptyTiles = true;
            Export.image.toCloudStorage(params);
            break;
        case 'drive':
            params.folder = folder;
            params.skipEmptyTiles = true;
            Export.image.toDrive(params);
            break;
    }
    if (verbose) print(options, params);
};


/**
 * Batch export GEE ImageCollection
 *
 * @param {ee.ImageCollection} ImgCol    The ImageCollection to export.
 * @param {array.<string>}     dateList  Corresponding date string list of ImgCol
 * @param {options} 
 * - `range`   : [lon_min, lat_min, lon_max, lat_max]
 * - `cellsize`: cellsize (in the unit of degree), used to calculate dimension.
 * - `type`    : export type, one of 'asset', 'cloud' and 'drive'
 * - `folder`  : The Folder that the export will reside in. If export type is cloud 
 * or asset, folder need to be absolute path.
 * - `crs`     : CRS to use for the exported image.
 * - `crsTransform`: Affine transform to use for the exported image. Requires "crs" to be defined.
 * - `dimensions`  : If specified, the calculated dimension from `cellsize` and 
 * `range` will be abandoned.
 * 
 * @param {String} prefix The prefix of the exported file name.
 */
pkg_export.ExportImgCol = function(ImgCol, dateList, options, prefix)
{    
    // Major update 
    /** 
     * If dateList was undefined, this function is low efficient.
     * ee.ImageCollection.toList() is quite slow, often lead to time out.
     */
    dateList = dateList || ee.List(ImgCol.aggregate_array('system:time_start'))
        .map(function(date){ return ee.Date(date).format('yyyy-MM-dd'); }).getInfo();

    // cellsize = cellsize || pkg_export.getProj(Image)['crsTransform'][0];
    // type   = type   || 'drive';
    // crs    = crs    || 'EPSG:4326'; // 'SR-ORG:6974';
    prefix = prefix || '';

    // dateList.evaluate(function(dateList) {
        var n = dateList.length;
        for (var i = 0; i < n; i++) {
            // var img  = ee.Image(colList.get(i));
            var date = dateList[i];
            var img  = ee.Image(ImgCol.filterDate(date).first()); 
            // var task = img.get('system:id');//.getInfo();
            var task = prefix + date;
            print(task);
            pkg_export.ExportImg(img, task, options); 
        }
    // });
};

// var pkg_debug = require('users/kongdd/public:debug.js');

/** 
 * split exporting range into multiple piece
 *
 * @param {[type]} range  [description]
 * @param {[type]} nx     [description]
 * @param {[type]} ny     [description]
 * @param {[type]} prefix [description]
 *
 * @examples
 * var range  = [-180, -60, 180, 90];
 * var ranges = SplitGrids(range, 2, 2, "prefix_"); 
 * print(ranges);
 * ranges.forEach(function(dict, ind){
 *     pkg_export.ExportImg(img_out, dict.range, dict.file, 1/240, 'drive', "");
 * });
 */
pkg_export.SplitRange2Grids = function (range, ny, nx, prefix) {
    nx = nx || 4;
    ny = ny || nx;
    prefix = prefix || "";

    var lat_range = range[3] - range[1],
        lon_range = range[2] - range[0],
        dy = lat_range / ny,
        dx = lon_range / nx;
    // print(lon_range, lat_range, dx, dy);

    var file, range_ij, lat_min, lat_max, lon_min, lon_max;
    var tasks = [],
        task;
    for (var i = 0; i < nx; i++) {
        lon_min = range[0] + i * dx;
        lon_max = lon_min + dx;
        for (var j = 0; j < ny; j++) {
            lat_min = range[1] + j * dy;
            lat_max = lat_min + dy;

            range_ij = [lon_min, lat_min, lon_max, lat_max];
            file = prefix + '_' + i.toString() + '_' + j.toString();
            tasks.push({ range: range_ij, file: file });
            // print(file, range_ij);
        }
    }
    return tasks;
};

pkg_export.ExportImg2 = function (Image, task, options) {
    var nrow = options.nrow || 5;
    var ncol = options.ncol || 2;
    
    var range  = options.range;
    var ranges = pkg_export.SplitRange2Grids(options.range, nrow, ncol, task);
    if (options.verbose) {
        print(ranges);
        options.verbose = false;
    }
    ranges.forEach(function (dict, ind) {
        options.range = dict.range;
        // if (options.verbose) print(dict.file, options.range)
        pkg_export.ExportImg(Image, dict.file, options);
    });
    options.range = range;
}; 


pkg_export.updateDict = function(dict_org, dict_new) {
    var key, keys = Object.keys(dict_new);
    for (var i = 0; i < keys.length; i++) {
        key = keys[i];
        dict_org[key] = dict_new[key];
    }
    // print(dict_org);
    return (dict_org);
};

pkg_export.export_shp = function(features, file, folder, fileFormat){
    folder     = folder || "";
    fileFormat = fileFormat || 'shp';
    
    features = features.map(function(f) { return f.set('index', f.get('system:index')); } );
    Export.table.toDrive({
        collection:features, 
        description:file, 
        folder:folder, 
        // fileNamePrefix, 
        fileFormat:'shp'
        // , selectors
    });
};


/**
 * Export_table
 *
 * @param  {ImageCollection}   ImgCol the ImageCollection data you want to
 * export.
 * @param  {FeatureCollection} points points used to clip ImgCol
 * @param  {boolean}           save   whether save or not
 * @param  {String}            file   filename
 * @return {FeatureCollection} If save = false, will return FeatureCollection.
 * Otherwise, none will be return. 
 */
pkg_export.Export_Table = function(export_data, save, file, folder, fileFormat) {
    save       = save       || false;
    folder     = folder     || "";
    fileFormat = fileFormat || "GeoJSON";

    // export params
    var params = {
        collection  : export_data, //.flatten(),
        description : file,
        folder      : folder,
        fileFormat  : fileFormat //GeoJSON, CSV
    };

    // If save, then export to drive, else print in the console
    if (save) {
        Export.table.toDrive(params);
    } else {
        print(file, export_data);
    }
};

pkg_export.get_bound = function (range) {
    return ee.Geometry.Rectangle(range, 'EPSG:4326', false);
}

pkg_export.range_global = [-180, -60, 180, 90]; // [long_min, lat_min, long_max, lat_max]
pkg_export.range_TP     = [73, 25, 105, 40];    // Tibetan Plateau

exports = pkg_export;
// print('pkg_export', pkg_export)
