/** 
 * This script is to fill gaps of MODIS 4-day LAI with the methods of 
 * weighted Whittaker with constant lambda
 * 
 * # 2018-04-25, Dongdong Kong (in pkgs/Math/Whittaker.js)
 * lambda = 500 (or 700) for 2-3 (or 4) years 4-day LAI images
 * 
 * # 2019-08-02, Dongdong Kong
 * Update for PML_V2 2018 images
 * 
 * # 2020-12-19, Dongdong Kong
 * fix export error and remove zombie scripts
 * 
 * Copyright (c) 2019 Dongdong Kong
 * 
 * @references
 * 1. Kong, D., Zhang, Y., Gu, X., & Wang, D. (2019). A robust method
 *     for reconstructing global MODIS EVI time series on the Google Earth Engine.
 *     *ISPRS Journal of Photogrammetry and Remote Sensing*, *155*(May), 13–24.
 *     https://doi.org/10.1016/j.isprsjprs.2019.06.014
 * 2. Zhang, Y.*, Kong, D.*, Gan, R., Chiew, F.H.S., McVicar, T.R., Zhang, Q., and 
 *     Yang, Y.. (2019) Coupled estimation of 500m and 8-day resolution global 
 *     evapotranspiration and gross primary production in 2002-2017. 
 *     Remote Sens. Environ. 222, 165-182, https://doi:10.1016/j.rse.2018.12.031 
 */
var imgcol_lai = ee.ImageCollection("MODIS/006/MCD15A3H");

var pkg_main = require('users/kongdd/public:pkg_main.js');
var pkg_vis  = require('users/kongdd/public:pkg_vis.js');
var pkg_whit = require('users/kongdd/public:Math/pkg_whit.js');

/** GLOBAL FUNCTIONS -------------------------------------------------------- */
function qc_LAI(img) {
    var FparLai_QC = img.select('FparLai_QC');
    var FparExtra_QC = img.select('FparExtra_QC');

    var qc_scf     = pkg_main.getQABits(FparLai_QC, 5, 7); //bit5-7, 1110 0000, shift 5
    var qc_snow    = pkg_main.getQABits(FparLai_QC, 2); //bit2, snow or ice
    var qc_aerosol = pkg_main.getQABits(FparLai_QC, 3); //bit3 
    var qc_cirrus  = pkg_main.getQABits(FparLai_QC, 4); //bit4
    var qc_cloud   = pkg_main.getQABits(FparLai_QC, 5); //bit5
    var qc_shadow  = pkg_main.getQABits(FparLai_QC, 6); //bit6
    /**
     * items               | weights
     * --------------------|--------
     * snow, cloud, shadow | 0
     * aerosol, cirrus     | 0.5
     */
    var w = img.select(0).mask(); //unknow why can use ee.Image(1)
    var q_0 = qc_snow.or(qc_cloud).or(qc_shadow);
    var q_1 = qc_aerosol.or(qc_cirrus);

    w = w.where(q_1, 0.5).where(q_0, 0.05);
    // var img2    = img.select('Lai').updateMask(qc_mask).divide(5);
    return ee.Image(img.select('Lai')).divide(10)
        .addBands([w, qc_scf, qc_snow, qc_aerosol, qc_cirrus, qc_cloud, qc_shadow])
        .rename(['Lai', 'w', 'qc_scf', 'qc_snow', 'qc_aerosol', 'qc_cirrus', 'qc_cloud', 'qc_shadow'])
        .copyProperties(img, img.propertyNames());
}
var date2str = function (x) { return ee.Date(x).format('YYYY_MM_dd'); };
/** ------------------------------------------------------------------------- */

// MAIN SCRIPT 
{
    /** Initial parameters for whittaker smoother --------------------------- */
    var lambda = 500;
    var year_begin = 2017,
        year_end = 2019, // year_beggin,
        date_begin = year_begin == 2002 ? '2002-07-01' : year_begin.toString().concat('-01-01'),
        date_end = year_end.toString().concat('-12-31');

    print(date_begin, date_end);
    var imgcol_lai = imgcol_lai.filterDate(date_begin, date_end); //.select('Lai');
    // mask is really important for dimension consistency
    var mask = imgcol_lai.select('Lai').mosaic().mask();
    var imgcol = imgcol_lai;

    /** 1. pre-process mask NA values and init weights */
    imgcol = imgcol.map(function (img) {
        img = img.unmask(-1.0);
        return ee.Image(qc_LAI(img)).updateMask(mask);
    });

    /** 2. Whittaker smoother ----------------------------------------------- */
    var options_whit = {
        order: 2,    // difference order
        wFUN: pkg_whit.wBisquare_array, // weigths updating function
        iters: 2,    // Whittaker iterations
        min_ValidPerc: 0,    // pixel valid ratio less then `min_ValidPerc`, is not smoothed.
        min_A: 0.02, // Amplitude A = ylu_max - ylu_min, points are masked if 
        // A < min_A. If ylu not specified, min_A not work
        missing: -0.05 // Missing value in band_sm are set to missing.
        // matrixSolve = 1;  // whittaker, matrix solve option:
        // 1:matrixSolve, 2:matrixCholeskyDecomposition, 3:matrixPseudoInverse 
    };

    var whit = pkg_whit.whit_imgcol(imgcol, options_whit, lambda);
    var mat_zs = whit.zs;
    var mat_ws = whit.ws;

    /** 3. convert 2d array into multi-bands -------------------------------- */
    var datelist = ee.List(imgcol.aggregate_array('system:time_start')).map(date2str);
    var ids = datelist.map(function (val) { return ee.String('b').cat(val); }); // print(ids);

    var img_out = mat_zs.arraySlice(1, -1).arrayProject([0]).arrayFlatten([ids]);//only select the last iter
    img_out = img_out.multiply(10).uint8();

    /** 4. EXPORT ----------------------------------------------------------- */
    var pkg_export = require('users/kongdd/public:pkg_export.js');
    var prj = pkg_export.getProj(imgcol);

    var options = {
        range    : [-180, -60, 180, 89],
        cellsize : 1 / 240,
        type     : 'asset',
        // folder   : 'projects/pml_evapotranspiration/PML_INPUTS/MODIS/LAI_whit_4d',
        crs      : 'SR-ORG:6974', 
        crsTransform: prj.crsTransform
    }

    var task = 'whit_'.concat(year_begin).concat('_').concat(year_end);
    // pkg_export.ExportImg(img_out, task, options);
    // pkg_export.ExportImgCol(img_out, null, options);
}

/** Visualization ----------------------------------------------------------- */
var palette = ['#570088', '#920057', '#CE0027', '#FF0A00', '#FF4500', '#FF8000', '#FFB100', '#FFD200', '#FFF200', '#C7EE03', '#70D209', '#18B80E', '#067F54', '#033FA9', '#0000FF'];
var vis = { min: 0.0, max: 50.0, palette: palette.reverse(), bands: 'Lai' };
Map.addLayer(imgcol, vis, 'LAI');
pkg_vis.grad_legend(vis, 'LAI*10');

/** ------------------------------------------------------------------------- */
// var val = ee.Image(mat_out).reduceRegion({reducer:ee.Reducer.toList(), geometry:point, scale:500});
var points = require('users/kongdd/public:data/flux_points.js').points;
// points = points.limit(80);    
var points_buf = points.map(function (f) { return ee.Feature(f).buffer(500) });

var panel = ui.Panel();
// panel.style().set('width', '600px');replace_mask
var app = {
    show: function () {
        // basemap
        Map.addLayer(points, {}, 'points');
        Map.addLayer(points_buf, {}, 'points_buf');

        var tool = InitSelect(true);
        print(panel);
        // ui.root.insert(0, panel);
    }
};
app.show();

function InitSelect(IsPrint) {
    if (typeof IsPrint === 'undefined') { IsPrint = false; }

    var FeaCol = points,
        name = 'site';
    FeaCol = FeaCol.sort(name);
    var names = FeaCol.aggregate_array(name).getInfo();

    var tool = ui.Select({ items: names, onChange: select_OnChange });
    panel.add(tool);
    tool.setValue(names[0]);
}

function select_OnChange(value) {
    var point = ee.Feature(points.filterMetadata('site', 'equals', value).first()).geometry(); //ee.Filter.eq('site', value)
    Map.centerObject(point, 14);

    var arraylist = ee.Array(mat_zs.sample(point, 500).first().get('array'));
    var p_whit = show_arrayseries(arraylist, 'imgcol_whit', point);
    panel.widgets().set(1, p_whit);
}

function show_arrayseries(arraylist, title, region) {
    if (typeof region === 'undefined') {
        region = ee.Feature(points.first());
    }
    // var Names = ['raw', Array(nrow-1).join().split(',').map(function(e, i) { return 'iter'.concat(i+1); })];
    /** setting items name and point & line shape*/
    var n = options_whit.iters;
    var xs = pkg_main.seq_len(n + 1);
    var Names = xs.map(function (i) { return 'iter'.concat(i); });
    Names[0] = 'raw';

    var series = xs.reduce(function (obj, i) {
        obj[i] = { lineWidth: 2, pointSize: 0 }; return obj;
    }, {});
    series[0] = { lineWidth: 0, pointSize: 2 };
    var p = ui.Chart.array.values({
        array: arraylist,
        axis: 0,
        xLabels: datelist,
    }).setOptions({
        title: title,
        series: series
    }).setSeriesNames(Names);
    return p;
}
