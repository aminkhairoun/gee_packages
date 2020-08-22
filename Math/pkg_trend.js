// var pkg_trend = require('users/kongdd/public:Math/pkg_trend.js');
var pkg_trend = {};

// img should only have dependant band
function createConstantBand(img) {
    // img = ee.Image(img);
    var year = ee.Image(ee.Number.parse(img.get('Year'))).toInt16();
    return img.addBands(ee.Image([1, year]));
}

function linearTrend(ImgCol, robust){
    if (robust  === undefined){ robust = false; }
    ImgCol = ImgCol.map(createConstantBand)
        .select([1, 2, 0], ['constant', 'Year', 'y']);
    
    var FUN;
    if (robust){
        FUN = ee.Reducer.robustLinearRegression(2, 1);
    }else{
        FUN = ee.Reducer.linearRegression(2, 1);
    }
    var n = ee.Number(ImgCol.size());
    var bandnames = ['offset', 'slope']; 

    var regression = ImgCol.reduce(FUN);
    var coef   = regression.select('coefficients').arrayProject([0]).arrayFlatten([bandnames]);
    // root mean square of the residuals of each dependent variable
    // actually, it is RMSE, not residuals
    var RMSE   = regression.select('residuals').arrayFlatten([['RMSE']]); 
    var offset = coef.select('offset');
    var slope  = coef.select('slope');

    /** try to get the tval to juage regression significant level */
    var Sx = n.multiply(n.add(1)).multiply(n.subtract(1)).divide(12);
    
    var tval, formula = false;
    if (formula){
        // solution1: statistical formula
        ImgCol = ImgCol.map(function(img){
          var pred = img.select(['Year']).multiply(slope).add(offset).rename('pred');
          var re   = img.expression('pow(y - pred, 2)', {NDVI:img.select('y'), pred:pred}).rename('re');
          return img.addBands(pred).addBands(re);
        });
        var Sy = ImgCol.select('re').sum();
        tval = slope.expression('slope/sqrt(Sy/(Sx*(n-2)))', {slope:slope, Sx:Sx, Sy:Sy, n:n}).rename('tval');
    }else{
        // solution2: lazy method
        var adj = n.divide(n.subtract(2)).sqrt();
        tval = RMSE.expression('slope/(b()*adj)*sqrt(Sx)', {slope:slope, Sx:Sx, adj:adj}).rename('tval');
    }
    return coef.addBands(tval);
}

function imgcol_trend(imgcol, band, robust){
    if (band   === undefined) {band = 0;}
    if (robust === undefined) {robust = true;}
    
    imgcol = imgcol.select(band).map(function(img){
        img = addSeasonProb(img);      // add seasonal variable
        // img = createConstantBand(img); // add constant and Year band
        return img;
    });
    var trend = linearTrend(imgcol, robust); //ee.Image
    return trend;
}

/**
 * [addSeasonProb description]
 *
 * add seasonal variables into img before regression
 * @param {[type]} img [description]
 * @param {boolean} pheno If true, 4-10 as growing season, spring:4-5, summer: 6-8, autumn:9-10
 *                        If false, just as traditional seasons.
 */
function addSeasonProb(img, pheno){
    if (pheno === undefined) {pheno = false;}
    
    var date  = ee.Date(img.get('system:time_start'));
    var month = date.get('month');
    var year  = date.get('year');
    var season;
    // year.subtract(1).multiply(10).add(4)
    var ingrow = ee.Algorithms.If(month.gte(4).and(month.lte(10)), "true", "false");

    if (pheno){
        /** 4-10 as growing season */
        season = ee.Algorithms.If(month.lte(3), ee.String(year.subtract(1)).cat("_winter"), season);
        season = ee.Algorithms.If(month.gte(4).and(month.lte(5)), ee.String(year).cat("_spring"), season);
        season = ee.Algorithms.If(month.gte(6).and(month.lte(8)), ee.String(year).cat("_summer"), season);
        season = ee.Algorithms.If(month.gte(9).and(month.lte(10)),ee.String(year).cat("_autumn"), season);
        season = ee.Algorithms.If(month.gte(11), ee.String(year).cat("_winter"), season);
    }else{
        /**traditional seasons*/
        season = ee.Algorithms.If(month.lte(2), ee.String(year.subtract(1)).cat("_winter"), season);
        season = ee.Algorithms.If(month.gte(3).and(month.lte(5)), ee.String(year).cat("_spring"), season);
        season = ee.Algorithms.If(month.gte(6).and(month.lte(8)), ee.String(year).cat("_summer"), season);
        season = ee.Algorithms.If(month.gte(9).and(month.lte(11)),ee.String(year).cat("_autumn"), season);
        season = ee.Algorithms.If(month.gte(12), ee.String(year).cat("_winter"), season);
    }
    
    return img.set('Season', season)
        .set('ingrow', ingrow)
        .set('Year-ingrow', year.format().cat('-').cat(ingrow))
        .set('Year', year.format())
        .set('Month', month.format("%02d"))
        .set('YearMonth', date.format('YYYY-MM')); //seasons.get(month.subtract(1))
}

/** add dn prop to every img */
function add_dn_date(img, beginDate, IncludeYear, n){
    beginDate = beginDate || img.get('system:time_start');
    if (IncludeYear === undefined) { IncludeYear = true; }
    n = n || 8;

    beginDate = ee.Date(beginDate);
    var year  = beginDate.get('year');
    var month = beginDate.get('month');

    var diff  = beginDate.difference(ee.Date.fromYMD(year, 1, 1), 'day').add(1);
    var dn    = diff.subtract(1).divide(n).floor().add(1).int();
    
    var yearstr  = year.format('%d'); //ee.String(year);
    dn   = dn.format('%02d'); //ee.String(dn);
    dn   = ee.Algorithms.If(IncludeYear, yearstr.cat("-").cat(dn), dn);
    
    return ee.Image(img)
        .set('system:time_start', beginDate.millis())
        // .set('system:time_end', beginDate.advance(1, 'day').millis())
        .set('date', beginDate.format('yyyy-MM-dd')) // system:id
        .set('Year', yearstr)
        .set('Month', beginDate.format('MM'))
        .set('YearMonth', beginDate.format('YYYY-MM'))
        .set('dn', dn); //add dn for aggregated into 8days
}

/**
 * return a function used to add dn property
 *
 * @param {boolean} IncludeYear [description]
 */
function add_dn(IncludeYear, n) {
    if (typeof IncludeYear === 'undefined') { IncludeYear = true; }
    if (typeof n === 'undefined') { n = 8; }
    return function(img){
        return add_dn_date(img, img.get('system:time_start'), IncludeYear, n);   
    };
}

/**
 * get empty imgcol by `seq.Date()`
 * @param {*} date_begin 
 * @param {*} date_end 
 * @param {*} by 
 */
function seq_imgcol(date_begin, date_end, by) {
    day_secs = 86400000
    by = by*day_secs || day_secs;

    var dates = ee.List.sequence(date_begin.millis(), date_end.millis(), by)
        .map(function(x) {return ee.Date(x); });
    /** blank ImgCol used to select the nearest Imgs */
    return dates.map(function(date){
        return add_dn_date(ee.Image(0), date);
    });
}

/** [hour3Todaily description] */


function imgcol_addSeasonProb(imgcol){
    return imgcol.map( function(img) { return addSeasonProb(img, false); } );
}

function imgcol_last(imgcol, n){
    n = n || 1;
    // ee.Image(imgcol_grace.reduce(ee.Reducer.last())); properties are missing
    var res = imgcol.toList(n, imgcol.size().subtract(n)); 
    if (n <= 1) { res = ee.Image(res.get(0)); }
    return res;
}

function showdata(ImgCol) {
    ImgCol.filter(filter_date).aside(print);
}

pkg_trend = {
    showdata            : showdata,
    addSeasonProb       : addSeasonProb,
    add_dn_date         : add_dn_date,
    add_dn              : add_dn,
    // dailyImgIters       : dailyImgIters,
    // hour3Todaily        : hour3Todaily, 
    linearTrend         : linearTrend,
    imgcol_trend        : imgcol_trend,
    createConstantBand  : createConstantBand,
    imgcol_addSeasonProb: imgcol_addSeasonProb,
    imgcol_last         : imgcol_last,
};

pkg_trend.YearDn_date = function(x, n){
    x = ee.String(x);
    n = n || 8;
    // var year = ee.Number.parse(x.slice(0,4));
    var i   = ee.Number.parse(x.slice(5,7));
    var doy = i.subtract(1).multiply(n).add(1);
    var datestr = x.slice(0, 5).cat(doy);
    // print(datestr, dn)
    return ee.Date.parse('Y-D', datestr); 
};

pkg_trend.copyProperties = function(source, destination, properties) {
    properties = properties || ['system:time_start']; // , 'system:id'
    return source.copyProperties(destination)
        .copyProperties(destination, properties);
};


/**
 * aggregate_prop
 *
 * @param  {[type]} ImgCol  [description]
 * @param  {[type]} prop    The value of "prop" should be string.
 * @param  {[type]} reducer [description]
 * @param  {boolean} delta  If true, reducer will be ignore, and return 
 *                          Just deltaY = y_end - y_begin. (for dataset like GRACE)
 * @return {[type]}         [description]
 */
pkg_trend.aggregate_prop = function (ImgCol, prop, reducerList, bandsList, delta) {
    function check_list(x) {
        if (!Array.isArray(x)) x = [x];
        return x;
    }

    var bands_all = ImgCol.first().bandNames();

    reducerList = reducerList || ['mean'];
    bandsList = bandsList || bands_all;
    if (delta === undefined) { delta = false; }

    reducerList = check_list(reducerList);
    bandsList = check_list(bandsList);
    var n = reducerList.length;
    if (bandsList.length === 1 && reducerList.length > 1) {
        temp = bandsList[0];
        bandsList = [];
        var temp = reducerList.forEach(function (reducer, i) {
            bandsList.push(temp);
        });
    }
    var dates = ee.Dictionary(ImgCol.aggregate_histogram(prop)).keys()
        .map(function (p) {
            return ee.Image(0).set(prop, p).set('system:id', p);
        });

    var filterDateEq = ee.Filter.equals({ leftField: prop, rightField: prop });
    var saveAllJoin = ee.Join.saveAll({
        matchesKey: 'matches',
        ordering: 'system:time_start',
        ascending: true
    });

    function process(img) {
        img = ee.Image(img);
        var imgcol = ee.ImageCollection.fromImages(img.get('matches')).sort('system:time_start'); //.fromImages

        var first = ee.Image(imgcol.first());
        var last = pkg_trend.imgcol_last(imgcol);

        var ans = ee.Image([]);
        if (!delta) {
            for (var i = 0; i < n; i++) {
                var bands = bandsList[i];
                var reducer = reducerList[i];
                // print('debug', i, bands, reducer)
                var img_new = imgcol.select(bands).reduce(reducer);
                // print(img_new)
                ans = ans.addBands(img_new);
            }
        } else {
            ans = last.subtract(first);
        }
        // print(ans, 'ans');
        return pkg_trend.copyProperties(ee.Image(ans), ee.Image(imgcol.first()))
            .copyProperties(img, ['system:id', prop]);
    }

    var ImgCol_new = saveAllJoin.apply(dates, ImgCol, filterDateEq)
        .map(process);
    // var img = ImgCol_new.first();
    // print(img, process(img))
    var bands = ee.List(bandsList).flatten();

    var out = ee.ImageCollection(ImgCol_new);
    if (reducerList.length === 1) {
        out = out.select(ee.List.sequence(0, bands.length().subtract(1)), bands);
    }
    return out;
};



// print(pkg_trend.YearDn_date('2010-45'));
exports = pkg_trend;
