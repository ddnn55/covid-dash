const minDay = "2020-01-01";
const colors = ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#46f0f0', '#f032e6', '#bcf60c', '#fabebe', '#008080', '#e6beff', '#9a6324', '#fffac8', '#800000', '#aaffc3', '#808000', '#ffd8b1', '#000075', '#808080', '#ffffff', '#000000'];
const nextColor = (() => {
  let nextColorIndex = 0;
  return () => {
    const color = colors[nextColorIndex];
    nextColorIndex = (nextColorIndex + 1) % colors.length;
    return color;
  };
})();
const colorFor = (() => {
  let colorLookup = {};
  return key => {
    if(!colorLookup[key]) {
      colorLookup[key] = nextColor();
    }
    return colorLookup[key];
  };
})();

const layout = document.querySelector(".layout");
const updateLayout = () => {
  layout.style.height = innerHeight + "px";
};
updateLayout();
window.addEventListener("resize", updateLayout);

const requestedRegionsStr = decodeURIComponent(window.location.search.slice(1));

  const requestedRegions = requestedRegionsStr
    .split(";")
    .map((regionStr) =>
      regionStr
        .split(",")
        .map((regionComponentStr) => regionComponentStr.replace(/\+/g, " "))
    );
  console.log({ requestedRegions })

  const getDatasetteCsv = async (url) => {
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

  const getCountiesMetadata = async () => {
    let counties = [];
    let offset = 0;
    let done = false;
    do {
      const result = await fetch(`https://covid-19.datasettes.com/covid.json?sql=select+date%2C+county%2C+state%2C+fips%2C+cases%2C+deaths%2C+population%2C+deaths_per_million%2C+cases_per_million+from+latest_ny_times_counties_with_populations+desc+limit+99999999999+offset+${offset}`);
      const json = await result.json();
      counties = counties.concat(json.rows);
      offset += json.rows.length;
      done = !json.truncated;
      console.log(json)
    } while (!done);
    return counties.map(([date, county, state, fips, cases, deaths, population]) => ({
      county,
      state,
      value: `${county}, ${state}`,
      pop_estimate_2019: population
    }));
  };

  const getStatesMetadata = async () => {
    const result = await fetch(`https://covid-19.datasettes.com/covid.json?sql=select+state_name%2C+pop_estimate_2019+from+us_census_state_populations_2019+where+state_id+!%3D+0`);
    const json = await result.json();
    return json.rows.map(([state_name, pop_estimate_2019]) => ({
      state: state_name,
      value: state_name,
      pop_estimate_2019
    }));
  };

  const getRegionsMetadata = async () => {
    const [countiesMetadata, statesMetadata] = await Promise.all([
      getCountiesMetadata(),
      getStatesMetadata()
    ]);
    return statesMetadata.concat(countiesMetadata);
  };

  const getStateData = async (state) => {
    return await getDatasetteCsv(
      `https://covid-19.datasettes.com/covid.csv?sql=select+rowid%2C+date%2C+state%2C+fips%2C+cases%2C+deaths+from+ny_times_us_states+where+date+%3E%3D+%22${minDay}%22+and+state+%3D+%22${encodeURIComponent(
        state
      )}%22+order+by+date+asc&_size=max`
    );
  };

  const getCountyData = async (county, state) => {
    return await getDatasetteCsv(
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
    // let longCountyName = `${shortCountyName} County`;
    return [shortCountyName, populations[state].counties[shortCountyName]];
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
        color: colorFor(region),
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

    const wikipediaRegions = [];

    const statePopulationRows = await loadDsv(
      "us-states-population-april-1-2020.tsv",
      "\t"
    );
    let populations = {};
    statePopulationRows.forEach(([state, pop]) => {
      const population = +pop.split(",").join("");
      populations[state] = {
        population: population,
        counties: {},
      };
      wikipediaRegions.push({
        value: state,
        state,
      });
    });

    const countyPopulationRows = await loadDsv(
      "us-counties-population-estimate-2019.tsv",
      "\t"
    );
    // console.log({ countyPopulationRows });
    countyPopulationRows.forEach(([county, state, pop]) => {
      const population = +pop.split(",").join("");
      populations[state].counties[county] = population;
      wikipediaRegions.push({
        value: `${county}, ${state}`,
        county,
        state,
      });
    });
    console.log({ wikipediaRegions })



    const requestedRegionsValue = [];
    const regionsDataRequests = requestedRegions.map((requestedRegion) => {
      if (requestedRegion.length === 1) {
        const [state] = requestedRegion;
        requestedRegionsValue.push({
          value: requestedRegion[0],
          state: requestedRegion[0],
        });
        return getStateData(requestedRegion[0]);
      } else if (requestedRegion.length === 2) {
        const [county, state] = requestedRegion;
        requestedRegionsValue.push({
          value: `${county}, ${state}`,
          county,
          state,
        });
        return getCountyData(requestedRegion[0], requestedRegion[1]);
      }
    });
    const regionsMetadataRequest = getRegionsMetadata();
    const [regionsMetadata, ...regionsData] = await Promise.all(
      [regionsMetadataRequest].concat(regionsDataRequests)
    );
    console.log({ regionsMetadata });

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

    const regionRows = newRegionRows;

    console.log({ regionRows });

    const byDay = _.groupBy(regionRows, (row) => row[0]);

    const days = Object.keys(byDay).sort();
    // const dateRange = [days[0], days[days.length - 1]].map((day) => {
    //   return `<b>${day}</b>`;
    //   // return dateFns.format(dateFns.parseISO(day), 'MMM D y');
    // });
    // document.querySelector(
    //   ".date-range"
    // ).innerHTML = `${dateRange[0]} to ${dateRange[1]}`;

    const byRegion = rows2smoothDailyRateByRegion(regionRows, populations);
    // console.log({ byRegion });

    const displaySet = { byRegion, byDay };
    // console.log({ displaySet });

    // debugger;
    const highchartsSeries = set2highcharts(displaySet);
    // debugger;
    console.log({ highchartsSeries });

    const chart = Highcharts.stockChart(chartContainer, {
      xAxis: {
        type: "datetime",
        labels: {
          autoRotation: false,
        },
        min: new Date('2021-01-01').getTime()
        // labels: {
        //     align: 'left'
        // }
      },
      yAxis: {
        floor: 0,
        title: {
          enabled: false,
        },
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
        enabled: false,
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
                  y: 12,
                },
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
    window.chart = chart;
    const serieses = {};
    chart.series.forEach(series => {
      serieses[series.name] = series;
    });

    const regionsToUriString = regions =>
      regions.map(region => ('county' in region ? `${region.county},${region.state}` : region.state).replace(/ /g, '+')).join(';');

    const DatasetteCsvLoader = (url, onComplete) => {
      const controller = new AbortController();
      const { signal } = controller;

      fetch(url, { signal }).then(response => {

        (async () => {
          let csv = (await response.text()).replace(/\r/g, "");
          if (csv[csv.length - 1] === "\n") {
            csv = csv.substring(0, csv.length - 1);
          }
          const parsedRows = csv.split("\n").map((line) => line.split(","));
          onComplete({
            columnNames: parsedRows[0],
            rows: parsedRows.slice(1),
          });
        })();

      }).catch(e => {
        console.warn(`Fetch 1 error: ${e.message}`);
      });

      return {
        cancel: () => controller.abort()
      }
    };

    const CountySeriesLoader = (region, onComplete) => {
      let canceled = false;
      const csvLoader = DatasetteCsvLoader(
        `https://covid-19.datasettes.com/covid.csv?` +
        `sql=select+rowid%2C+date%2C+county%2C+state%2C+fips%2C+cases%2C+deaths+from+ny_times_us_counties+where+%22county%22+%3D+%3Ap0+and+%22state%22+%3D+%3Ap1+and+%22date%22+%3E%3D+%22${minDay}%22+order+by+date+desc` +
        `&p0=${encodeURIComponent(region.county)}` +
        `&p1=${encodeURIComponent(region.state)}` +
        `&_size=max`,
        ({columnNames, rows}) => {
          if(canceled) {
            return;
          }
          onComplete({columnNames, rows});
        }
      );
      return {
        cancel: () => {canceled = true; csvLoader.cancel()}
      };
    };
    const StateSeriesLoader = (region, onComplete) => {
      let canceled = false;
      const csvLoader = DatasetteCsvLoader(
        `https://covid-19.datasettes.com/covid.csv?sql=select+rowid%2C+date%2C+state%2C+fips%2C+cases%2C+deaths+from+ny_times_us_states+where+date+%3E%3D+%22${minDay}%22+and+state+%3D+%22${encodeURIComponent(
          region.state
        )}%22+order+by+date+asc&_size=max`,
        ({columnNames, rows}) => {
          if(canceled) {
            return;
          }
          onComplete({columnNames, rows});
        }
      );
      return {
        cancel: () => {canceled = true; csvLoader.cancel()}
      };
    };

    const formatAndAdd = ({columnNames, rows}) => {
      const entries = rows.map(row => Object.fromEntries(
        columnNames.map((columnName, c) => ([
          columnName,
          row[c]
        ]))
      ));
      const normalizedRows = entries.map(({date, county, state, cases, deaths}) => ([
        date,
        county || null,
        state,
        +cases,
        +deaths
      ]));
      const sortedNormalizedRows = _.sortBy(normalizedRows, row => row[0]);
      const byRegion = rows2smoothDailyRateByRegion(sortedNormalizedRows, populations);
      const byDay = _.groupBy(sortedNormalizedRows, (row) => row[0]);
      const highchartsSerieses = set2highcharts({byRegion, byDay});
      const actualHighchartsSeries = chart.addSeries(highchartsSerieses[0]);
      serieses[actualHighchartsSeries.name] = actualHighchartsSeries;
      console.log('formatAndAdd', {highchartsSerieses});

    };

    const RegionLoader = (region, onComplete) => region.county
        ? CountySeriesLoader(region, (...all) => {
          formatAndAdd(...all);
          onComplete();
        })
        : StateSeriesLoader(region, (...all) => {
          formatAndAdd(...all);
          onComplete();
        });

    let tagify;
    const loading = {};
    window.loading = loading;
    const changedRegions = () => {
      history.replaceState({}, '', `/?${regionsToUriString(tagify.value)}`)
      chart.reflow();
    };
    const addedRegion = (tagifyEvent) => {
      const { type, detail: { data: region } } = tagifyEvent;
      console.log('added', region);
      const name = region.value;
      loading[name] = RegionLoader(region, () => delete loading[name]);
      changedRegions();
    };
    const removedRegion = (tagifyEvent) => {
      const { type, detail: { data: region } } = tagifyEvent;
      console.log('removed', region);
      if (loading[region.value]) {
        loading[region.value].cancel();
      }

      serieses[region.value] && serieses[region.value].remove();
      delete serieses[region.value];
      changedRegions();
    };
    const tagifyInputContainer = document.querySelector('.regions-selector-container');
    tagifyInputContainer.style.display = 'block';
    const tagifyInput = tagifyInputContainer.querySelector('textarea');
    tagifyInput.value = JSON.stringify(requestedRegionsValue);
    tagifyInput.style.display = 'block';
    const transformTag = (tagData) => {
      console.log(tagData.value);
      console.log(serieses[tagData.value]);
      // tagData.style = "--tag-bg:" + serieses[tagData.value].color;
      tagData.style = `--tag-bg: ${colorFor(tagData.value)}`;
    };
    tagify = new Tagify(tagifyInput, {
      enforceWhitelist: true,
      delimiters: null,
      // whitelist        : regionsMetadata, // missing NYC counties at time of writing
      whitelist: wikipediaRegions,

      transformTag,

      templates: {
        // tag: region => region.formatted,
        // dropdownItem: region => region.formatted
      },
      callbacks: {
        add: addedRegion,  // callback when adding a tag
        remove: removedRegion   // callback when removing a tag
      }
    });
    chart.reflow();

  })();
