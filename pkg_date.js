/**
 * Copyright (c) 2019 Dongdong Kong. All rights reserved.
 * This work is licensed under the terms of the MIT license.
 * For a copy, see <https://opensource.org/licenses/MIT>.
 *
 * @usage:
 * var pkg_ET = require('users/kongdd/public:pkg_date.js');
 */
var pkg_date = {};

pkg_date.seq = function(from, to, by) {
    by = by || 1;
    var res = [];
    for (var i = from; i <= to; i += by) { res.push(i); }
    return res;
};

pkg_date.leapYear = function(year) {
    return ((year % 4 === 0) && (year % 100 !== 0)) || (year % 400 === 0);
};

pkg_date.date_format = function(date) {
    return ee.Date(date).format('yyyy-MM-dd');
};

pkg_date.min_date = function(x, y) {
    return ee.Date(ee.Algorithms.If(x.millis().gt(y.millis()), y, x));
};

pkg_date.max_date = function(x, y) {
    return ee.Date(ee.Algorithms.If(x.millis().gt(y.millis()), x, y));
};

pkg_date.days_in_month = function(date) {
    // var date = ee.Date(img.get('system:time_start'));
    var year = date.get("year");
    var month = date.get("month");
    var monthDateBegin = ee.Date.fromYMD(year, month, 1);
    return monthDateBegin.advance(1, 'month').advance(-1, 'day').get('day');
};

pkg_date.dndate_end = function(date, dn) {
    dn = dn || 8;
    var year = date.get("year");
    // var month = date.get("month");
    // var date_begin = date;
    var date_max = ee.Date.fromYMD(year, 12, 31);
    var date_end = date.advance(dn - 1, "day");
    return min_date(date_end, date_max);
};

pkg_date.days_of_coverage = function(img, dn) {
    var date = ee.Date(img.get('system:time_start'));
    var date_end = pkg_date.dndate_end(date, dn);
    var days = date_end.difference(date, "day").add(1);
    return img.set("days_coverage", days);
};

/**
 * overlaped days
 * 
 * @param {*} period1 [date_begin, date_end]
 * @param {*} period2 [monthDate_begin, monthDate_end]
 */
pkg_date.overlap_days = function(period1, period2) {
    var date_begin = pkg_date.max_date(period1[0], period2[0]);
    var date_end = pkg_date.min_date(period1[1], period2[1]);
    return date_end.difference(date_begin, "day").add(1); // days
};

pkg_date.overlapDaysInMonth = function(img, period2, dn) {
    var date = ee.Date(img.get('system:time_start'));
    var year = date.get("year");

    var date_end = pkg_date.dndate_end(date, dn);
    var period1 = [date, date_end];
    // var period2 = [ee.Date.fromYMD(year, month, 1),
    //     ee.Date.fromYMD(year, month, days_in_month(date))];
    return img.set("overlap_days", pkg_date.overlap_days(period1, period2))
        .set('date_start', pkg_date.date_format(date))
        .set('date_end', pkg_date.date_format(date_end))
        .set('date_end_org', ee.Date(img.get('system:time_end')));
};

// Function to monthly aggregation
pkg_date.dn2mon = function(imgcol, year_begin, year_end, scale_factor) {
    year_end = year_end || year_begin;
    scale_factor = scale_factor || 1;
    // in the debug mode
    var years = pkg_date.seq(year_begin, year_end);
    var months = pkg_date.seq(1, 12);

    var res = years.map(function (year) {
        var imgcol_year = imgcol.filter(ee.Filter.calendarRange(year, year, "year"));
        return months.map(function (month) {
            var dateMonth_begin = ee.Date.fromYMD(year, month, 1);
            var days_month = pkg_date.days_in_month(dateMonth_begin);
            var dateMonth_end = ee.Date.fromYMD(year, month, days_month);
            var period2 = [dateMonth_begin, dateMonth_end];

            // print(dateMonth_begin, days_in_month(dateMonth_begin), dateMonth_end);
            // var filter = ee.Filter.calendarRange(month, month, "month");
            var filter = ee.Filter.and(
                ee.Filter.lte("system:time_start", dateMonth_end.millis()),
                ee.Filter.gte("system:time_end", dateMonth_begin.millis()));

            var imgcoli = imgcol_year.filter(filter);
            imgcoli = imgcoli.map(function (img) {
                img = pkg_date.overlapDaysInMonth(img, period2, dn);
                var days = img.mask().multiply(ee.Number(img.get("overlap_days")))
                    .rename('days_coverage').toInt();
                return ee.Image(img).toFloat()
                    .multiply(days.multiply(scale_factor))
                    .addBands(days)
                    .copyProperties(img, img.propertyNames());
            });

            var img_sum = imgcoli.sum()
                .set('system:time_start', dateMonth_begin.millis())
                .set('system:time_end', dateMonth_end.millis())
                .set('date_start', pkg_date.date_format(dateMonth_begin))
                .set('date_end', pkg_date.date_format(dateMonth_end))
                .set('system:id', pkg_date.date_format(dateMonth_begin)); // 
            var ETsum = img_sum.expression("b(0)/b('days_coverage') * days",
                { days: days_month }).rename("ETsum");
            return img_sum.addBands(ETsum);
        });
    });
    return ee.ImageCollection(ee.List(res).flatten());
};

pkg_date.dn2year = function (imgcol, year_begin, year_end, scale_factor) {
    year_end = year_end || year_begin;
    scale_factor = scale_factor || 1;
    // in the debug mode
    var years = pkg_date.seq(year_begin, year_end);

    var res = years.map(function (year) {
        var imgcoli = imgcol.filter(ee.Filter.calendarRange(year, year, "year"));

        imgcoli = imgcoli.map(function (img) {
            img = pkg_date.days_of_coverage(img, dn);
            var days = ee.Number(img.get("days_coverage"));
            days = img.mask().multiply(days).rename('days_coverage');
            return ee.Image(img).toFloat()
                .multiply(days.multiply(scale_factor))
                .addBands(days)
                .copyProperties(img, img.propertyNames());
        });

        var date = ee.Date.fromYMD(year, 1, 1);
        var date_end = ee.Date.fromYMD(year, 12, 31);
        var img_sum = imgcoli.sum()
            .set('system:time_start', date.millis())
            .set('system:time_end', date_end.millis())
            .set('date_start', pkg_date.date_format(date))
            .set('date_end', pkg_date.date_format(date_end))
            .set('system:id', pkg_date.date_format(date)); // 
        // print(img_sum);
        var ETsum = img_sum.expression("b(0)/b('days_coverage') * days",
            { days: pkg_date.leapYear(year) + 365 }).rename("ETsum");
        return img_sum.addBands(ETsum);
    });
    return ee.ImageCollection(ee.List(res).flatten());
};

exports = pkg_date;
