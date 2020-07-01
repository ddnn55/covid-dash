const minDay = "2020-03-01";

const selectedCounties = new Set();
selectedCounties.add('Los Angeles');
selectedCounties.add('Cook');
selectedCounties.add('Champaign');

const chartContainer = document.querySelector('.chart-container');
const table = document.querySelector('.table');

const loadDsv = async (url, separator) => {
    const result = await fetch(url);
    const dsvText = await result.text();
    return dsvText.split('\n').slice(1).map(line => line.split(separator));
};

const loadStateRows = async url => (await loadDsv(url, ',')).map(([day, state, __, positives, deaths]) => [day, null, state, +positives, +deaths]).filter(row => row[0] >= minDay);
const loadCountyRows = async url => (await loadDsv(url, ',')).map(([day, county, state, fips, positives, deaths]) => [day, county, state, +positives, +deaths]).filter(row => row[0] >= minDay);


const rows2smoothDailyRate = ([county, state], rows, populations) => {

    // calculate daily change
    const dailyChange = rows.map((row, r) => {
        const changeCases = r === 0 ? row[3] : row[3] - rows[r - 1][3];
        // const sevenDayAverage = 
        return [
            row[0],
            changeCases
        ];
    });

    // calculate 7 day average change per capita
    const smoothDailyChange = dailyChange.map((row, r) => {
        const [day, _positives] = row;
        const population = county === null ? populations[state].population : populations[state].counties[county];
        return [
            day,
            // row[1],
            // row[2],
            100000 * sevenDayAverage(dailyChange, r) / population
        ];
    });

    const byDay = _.keyBy(smoothDailyChange, row => row[0]);

    if(county === 'Cook') {
        debugger;
    }

    return byDay;
};

const rows2smoothDailyRateByRegion = (rows, populations) => {
    const regionalTree = {};
    rows.forEach(row => {
        const [day, county, state, positives, deaths] = row;
        regionalTree[state] = regionalTree[state] || {
            rows: [],
            counties: {}
        };
        if(county === null) {
            regionalTree[state].rows.push(row); 
        }
        else {
            regionalTree[state].counties[county] = regionalTree[state].counties[county] || [];
            regionalTree[state].counties[county].push(row);
        }
    });

    const byRegion = {};

    Object.keys(regionalTree).map(state => {
        byRegion[state] = rows2smoothDailyRate([null, state], regionalTree[state].rows, populations);
        Object.keys(regionalTree[state].counties).map(county => {
            byRegion[`${county}, ${state}`] = rows2smoothDailyRate([county, state], regionalTree[state].counties[county], populations);
        });
    });

    return byRegion;
};


const union = (a, b) => { 
    const { byRegion: byRegionA, byDay: byDayA } = a;
    const { byRegion: byRegionB, byDay: byDayB } = b;
    console.log({byRegionA, byRegionB, byDayA, byDayB});
 };
const byRegionFilterByRegions = (byRegion, regions) => {
    const newByRegion = {};
    regions.forEach(region => {
        newByRegion[region] = byRegion[region];
    });
    return newByRegion;
};
const byDayFilterByRegions = (byDay, regions) => {
    const newByDay = {};
    Object.keys(byDay).forEach(day => {
        newByDay[day] = byDay[day].filter(([__, region, ___, ____]) => regions.indexOf(region) > -1);
    });
    return newByDay;
};
const subset = (set, regions) => {
    console.log({set, regions})
    return {
        byDay: byDayFilterByRegions(set.byDay, regions),
        byRegion: byRegionFilterByRegions(set.byRegion, regions)
    };
};

const set2highcharts = set => _.sortBy(Object.keys(set.byRegion).map(region => ({
    name: region,
    data: Object.keys(set.byDay).map(day => set.byRegion[region][day] ? set.byRegion[region][day][1] : 0)
})), regionSeries => regionSeries.name);

const sevenDayAverage = (rows, r) => {
    const startIndex = Math.max(0, r - 6);
    const windowRows = rows.slice(startIndex, r + 1);
    const sum = _.sum(windowRows.map(row => row[1]));
    const count = (r + 1 - startIndex);
    return sum / count;
};

(async () => {

    const statePopulationRows = await loadDsv("us-states-population-april-1-2020.tsv", "\t");
    let populations = {};
    statePopulationRows.forEach(([state, pop]) => {
        populations[state] = {
            population: +pop.split(',').join(''),
            counties: {}
        };
    });
    // console.log(statePopulations)

    const countyPopulationRows = await loadDsv("us-counties-population-estimate-2019.tsv", "\t");
    console.log({countyPopulationRows})
    countyPopulationRows.forEach(([county, state, pop]) => {
        // if(selectedCounties.has(JSON.stringify([county, state]))) {
            populations[state].counties[county] = +pop.split(',').join('');
        // }
    });
    
    console.log({populations})

    const stateRows = await loadStateRows("https://raw.githubusercontent.com/nytimes/covid-19-data/master/us-states.csv");
    const allCountyRows = await loadCountyRows("https://raw.githubusercontent.com/nytimes/covid-19-data/master/us-counties.csv");
    console.log({allCountyRows});
    const selectedCountyRows = allCountyRows.filter(([__, county, ___, ____]) => selectedCounties.has(county, ));
    console.log({selectedCountyRows})

    const regionRows = _.sortBy(stateRows.concat(selectedCountyRows), row => row[0]);
    console.log({regionRows})

    // table.innerHTML = JSON.stringify(stateRows, null, 2);
    const byDay = _.groupBy(regionRows, row => row[0]);
    // const countiesByDay = _.groupBy(countyRows, row => row[0]);
    // console.log(statesByDay)

    // const statesByRegion = rows2smoothDailyRateByRegion(stateRows, statePopulations);
    // const countiesByRegion = rows2smoothDailyRateByRegion(countyRows, countyPopulations);
    const byRegion = rows2smoothDailyRateByRegion(regionRows, populations);
    console.log({ byRegion });

    // const statesSet   = { byRegion: statesByRegion,   byDay: statesByDay   };
    // const countiesSet = { byRegion: countiesByRegion, byDay: countiesByDay };

    const displaySet = {byRegion, byDay};
    console.log({ displaySet });

    const highchartsSeries = set2highcharts(displaySet);
    console.log({ highchartsSeries })

    Highcharts.chart(chartContainer, {
        xAxis: {
            // categories: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
            categories: Object.keys(byDay),
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