const minDay = "2020-03-01";

const layout = document.querySelector('.layout');
const updateLayout = () => {
    layout.style.height = innerHeight + 'px';
};
updateLayout();
window.addEventListener('resize', updateLayout);

const requestedRegionsStr = decodeURIComponent(window.location.search.slice(1));
if (requestedRegionsStr.length === 0) {
    document.querySelector(".instructions").style.display = "block";
    document.querySelector(".change").style.display = "none";
} else {
  const requestedRegions = requestedRegionsStr
    .split(";")
    .map((regionStr) =>
      regionStr
        .split(",")
        .map((regionComponentStr) => regionComponentStr.replace(/\+/g, " "))
    );

  const getDatasetteData = async (url) => {
    const result = await fetch(url);
    let csv = (await result.text()).replace(/\r/g, "");
    if (csv[csv.length - 1] === "\n") {
      csv = csv.substring(0, csv.length - 1);
    }
    const parsedRows = csv.split("\n").map((line) => line.split(","));
    return {
      columnNames: parsedRows[0],
      rows: parsedRows.slice(1),
    };
  };

  const getStateData = async (state) => {
    return await getDatasetteData(
      `https://covid-19.datasettes.com/covid.csv?sql=select+rowid%2C+date%2C+state%2C+fips%2C+cases%2C+deaths+from+ny_times_us_states+where+date+%3E%3D+%22${minDay}%22+and+state+%3D+%22${encodeURIComponent(
        state
      )}%22+order+by+date+asc&_size=max`
    );
  };

  const getCountyData = async (county, state) => {
    return await getDatasetteData(
      `https://covid-19.datasettes.com/covid.csv?` +
        `sql=select+rowid%2C+date%2C+county%2C+state%2C+fips%2C+cases%2C+deaths+from+ny_times_us_counties+where+%22county%22+%3D+%3Ap0+and+%22state%22+%3D+%3Ap1+and+%22date%22+%3E%3D+%22${minDay}%22+order+by+date+desc` +
        `&p0=${encodeURIComponent(county)}` +
        `&p1=${encodeURIComponent(state)}` +
        `&_size=max`
    );
  };

  const chartContainer = document.querySelector(".chart-container");

  const loadDsv = async (url, separator) => {
    const result = await fetch(url);
    const dsvText = await result.text();
    return dsvText
      .split("\n")
      .slice(1)
      .map((line) => line.split(separator));
  };

  const findCountyNameAndPopulation = (
    [shortCountyName, state],
    populations
  ) => {
    let longCountyName = `${shortCountyName} County`;
    return [longCountyName, populations[state].counties[longCountyName]];
  };

  const processRegionRows = ([county, state], rows, populations) => {
    // calculate daily change
    const dailyChange = rows.map((row, r) => {
      const changeCases = r === 0 ? row[3] : row[3] - rows[r - 1][3];
      return [row[0], changeCases];
    });

    // calculate 7 day average change per capita
    let population;
    let name;
    if (county === null) {
      population = populations[state].population;
      name = state;
    } else {
      const [countyName, _population] = findCountyNameAndPopulation(
        [county, state],
        populations
      );
      population = _population;
      name = `${countyName}, ${state}`;
    }
    const smoothDailyChange = dailyChange.map((row, r) => {
      const [day, _positives] = row;
      return [
        day,
        // row[1],
        // row[2],
        (100000 * sevenDayAverage(dailyChange, r)) / population,
      ];
    });

    const byDay = _.keyBy(smoothDailyChange, (row) => row[0]);

    return [name, byDay];
  };

  const rows2smoothDailyRateByRegion = (rows, populations) => {
    const regionalTree = {};
    rows.forEach((row) => {
      const [day, county, state, positives, deaths] = row;
      regionalTree[state] = regionalTree[state] || {
        rows: [],
        counties: {},
      };
      if (county === null) {
        regionalTree[state].rows.push(row);
      } else {
        regionalTree[state].counties[county] =
          regionalTree[state].counties[county] || [];
        regionalTree[state].counties[county].push(row);
      }
    });

    const byRegion = {};

    Object.keys(regionalTree).map((state) => {
      const [name, processedRows] = processRegionRows(
        [null, state],
        regionalTree[state].rows,
        populations
      );
      byRegion[name] = processedRows;
      Object.keys(regionalTree[state].counties).map((county) => {
        const [name, processedRows] = processRegionRows(
          [county, state],
          regionalTree[state].counties[county],
          populations
        );
        byRegion[name] = processedRows;
      });
    });

    // regionalTree is an unecessary legacy format that results in empty regions
    // if a county's state is not explicitly requested. in the interest of
    // the developer's time, we just remove those empty regions here.
    Object.keys(byRegion).forEach((regionKey) => {
      if (Object.keys(byRegion[regionKey]).length === 0) {
        delete byRegion[regionKey];
      }
    });

    return byRegion;
  };


  const set2highcharts = (set) =>
    _.sortBy(
      Object.keys(set.byRegion).map((region) => ({
        name: region,
        data: Object.keys(set.byDay).map((day) => [
          new Date(day).getTime(),
          set.byRegion[region][day] ? set.byRegion[region][day][1] : 0,
        ]),
      })),
      (regionSeries) => regionSeries.name
    );

  const sevenDayAverage = (rows, r) => {
    const startIndex = Math.max(0, r - 6);
    const windowRows = rows.slice(startIndex, r + 1);
    const sum = _.sum(windowRows.map((row) => row[1]));
    const count = r + 1 - startIndex;
    return sum / count;
  };

  (async () => {
    const regionsData = await Promise.all(
      requestedRegions.map((requestedRegion) => {
        if (requestedRegion.length === 1) {
          return getStateData(requestedRegion[0]);
        } else if (requestedRegion.length === 2) {
          return getCountyData(requestedRegion[0], requestedRegion[1]);
        }
      })
    );
    console.log({ regionsData });
    let newRegionRows = [];
    regionsData.forEach((regionData) => {
      regionData.rows.forEach((regionRow) => {
        const rowObj = {};
        regionRow.forEach(
          (column, c) => (rowObj[regionData.columnNames[c]] = column)
        );
        rowObj.cases = +rowObj.cases;
        rowObj.deaths = +rowObj.deaths;
        newRegionRows.push([
          rowObj.date,
          rowObj.county || null,
          rowObj.state,
          rowObj.cases,
          rowObj.deaths,
        ]);
      });
    });
    newRegionRows = _.sortBy(newRegionRows, (row) => row[0]);

    const statePopulationRows = await loadDsv(
      "us-states-population-april-1-2020.tsv",
      "\t"
    );
    let populations = {};
    statePopulationRows.forEach(([state, pop]) => {
      populations[state] = {
        population: +pop.split(",").join(""),
        counties: {},
      };
    });

    const countyPopulationRows = await loadDsv(
      "us-counties-population-estimate-2019.tsv",
      "\t"
    );
    console.log({ countyPopulationRows });
    countyPopulationRows.forEach(([county, state, pop]) => {
      populations[state].counties[county] = +pop.split(",").join("");
    });

    const regionRows = newRegionRows;

    console.log({ regionRows });

    const byDay = _.groupBy(regionRows, (row) => row[0]);

    const days = Object.keys(byDay).sort();
    const dateRange = [days[0], days[days.length-1]].map(day => {
        return `<b>${day}</b>`;
        // return dateFns.format(dateFns.parseISO(day), 'MMM D y');
    });
    document.querySelector('.date-range').innerHTML = `${dateRange[0]} to ${dateRange[1]}`;

    const byRegion = rows2smoothDailyRateByRegion(regionRows, populations);
    console.log({ byRegion });

    const displaySet = { byRegion, byDay };
    console.log({ displaySet });

    const highchartsSeries = set2highcharts(displaySet);
    // debugger;
    console.log({ highchartsSeries });

    Highcharts.chart(chartContainer, {
      xAxis: {
        type: "datetime",
        labels: {
            autoRotation: false
        }
        // min: new Date('2020-03-01').getTime()
        // labels: {
        //     align: 'left'
        // }
      },
      yAxis: {
        floor: 0,
        title: {
            enabled: false
        }
      },

      chart: {
        // height: innerHeight
      },
      title: {
        text: "",
      },

      series: highchartsSeries,

      plotOptions: {
        series: {
          marker: {
            enabled: false,
          },
        },
      },

      legend: {
        enabled: true,
        layout: "vertical",
        align: "right",
      },
      responsive: {
        rules: [
          {
            condition: {
              maxWidth: 800,
            },
            chartOptions: {
                xAxis: {

            // startOnTick: true,
            // endOnTick: true,
                },
                yAxis: {

        labels: {
            // align: 'center'
            x: 15,
            y: 12
        }
                },
              legend: {
                align: "center",
                verticalAlign: "bottom",
                layout: "horizontal",
              },
            },
          },
        ],
      },
    });
  })();
}
