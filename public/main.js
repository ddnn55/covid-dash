const minDay = "2020-03-01";

const chartContainer = document.querySelector('.chart-container');
const table = document.querySelector('.table');

const loadDsv = async (url, separator) => {
    const result = await fetch(url);
    const dsvText = await result.text();
    return dsvText.split('\n').slice(1).map(line => line.split(separator));
};

const loadCovidRows = async url => (await loadDsv(url, ',')).map(([day, region, __, positives, deaths]) => [day, region, +positives, +deaths]).filter(row => row[0] >= minDay);

const rows2smoothDailyRateByRegion = (rows, populations) => {
    const smoothDailyRateByRegion = _.groupBy(rows, row => row[1]);
    for (const region in smoothDailyRateByRegion) {

        // calculate daily change
        smoothDailyRateByRegion[region] = smoothDailyRateByRegion[region].map((row, r) => {
            const changeCases = r === 0 ? row[2] : row[2] - smoothDailyRateByRegion[region][r - 1][2];
            // const sevenDayAverage = 
            return [
                row[0],
                row[1],
                changeCases
            ];
        });

        // calculate 7 day average change per capita
        smoothDailyRateByRegion[region] = smoothDailyRateByRegion[region].map((row, r) => {
            return [
                row[0],
                row[1],
                row[2],
                100000 * sevenDayAverage(smoothDailyRateByRegion[region], r) / populations[region]
            ];
        });

        smoothDailyRateByRegion[region] = _.keyBy(smoothDailyRateByRegion[region], row => row[0]);
    };
    return smoothDailyRateByRegion;
};

const union = (a, b) => { };
const subset = (set, keys) => {};

const set2highcharts = set => _.sortBy(Object.keys(set.byRegion).map(region => ({
    name: region,
    data: Object.keys(set.byDay).map(day => set.byRegion[region][day] ? set.byRegion[region][day][3] : 0)
})), regionSeries => regionSeries.name);

const sevenDayAverage = (rows, r) => {
    const startIndex = Math.max(0, r - 6);
    const windowRows = rows.slice(startIndex, r + 1);
    const sum = _.sum(windowRows.map(row => row[2]));
    const count = (r + 1 - startIndex);
    return sum / count;
};

(async () => {

    const populationRows = await loadDsv("us-states-population-april-1-2020.tsv", "\t");
    let statePopulations = {};
    populationRows.forEach(([name, pop]) => {
        statePopulations[name] = +pop.split(',').join('');
    });
    // console.log(statePopulations)

    const stateRows = await loadCovidRows("https://raw.githubusercontent.com/nytimes/covid-19-data/master/us-states.csv");
    const countyRows = await loadCovidRows("https://raw.githubusercontent.com/nytimes/covid-19-data/master/us-counties.csv");
    // console.log({countyRows});

    const countiesByDay = _.groupBy(countyRows, row => row[0]);
    const countiesByRegion = _.groupBy(countyRows, row => row[1]);
    console.log({ countiesByRegion })

    // table.innerHTML = JSON.stringify(stateRows, null, 2);
    const statesByDay = _.groupBy(stateRows, row => row[0]);
    // console.log(statesByDay)

    const statesByRegion = rows2smoothDailyRateByRegion(stateRows, statePopulations);
    console.log({ statesByRegion });

    const statesSet   = { byRegion: statesByRegion,   byDay: statesByDay   };
    const countiesSet = { byRegion: countiesByRegion, byDay: countiesByDay };

    const displaySet = union(statesSet, subset(countiesSet, ['Los Angeles', 'Cook', 'Champaign']));
    console.log({ displaySet });

    const highchartsSeries = set2highcharts(statesSet);
    console.log({ highchartsSeries })

    Highcharts.chart(chartContainer, {
        xAxis: {
            // categories: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
            categories: Object.keys(statesByDay),
        },
        yAxis: {
            floor: 0
        },

        chart: {
            // height: innerHeight
        },
        title: {
            text: ""
        },

        series: highchartsSeries,

        plotOptions: {
            series: {
                marker: {
                    enabled: false
                }
            }
        },

        legend: {
            enabled: true,
            layout: 'vertical',
            align: 'right'
        }
    });
})();