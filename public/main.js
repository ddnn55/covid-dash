const minDay = "2020-03-01";

const layout = document.querySelector(".layout");
const updateLayout = () => {
  layout.style.height = innerHeight + "px";
};
updateLayout();
window.addEventListener("resize", updateLayout);

const requestedRegionsStr = decodeURIComponent(window.location.search.slice(1));
if (requestedRegionsStr.length === 0) {
  document.querySelector(".instructions").style.display = "block";
} else {
  const requestedRegions = requestedRegionsStr
    .split(";")
    .map((regionStr) =>
      regionStr
        .split(",")
        .map((regionComponentStr) => regionComponentStr.replace(/\+/g, " "))
    );

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
    } while(!done);
    return counties.map(([date, county, state, fips, cases, deaths, population]) => ({
      county,
      state,
      pop_estimate_2019: population
    }));
  };

  const getStatesMetadata = async () => {
    const result = await fetch(`https://covid-19.datasettes.com/covid.json?sql=select+state_name%2C+pop_estimate_2019+from+us_census_state_populations_2019+where+state_id+!%3D+0`);
    const json = await result.json();
    return json.rows.map(([state_name, pop_estimate_2019]) => ({
      state: state_name,
      pop_estimate_2019
    }));
  };

  const getRegionsMetadata = async () => {
    const [countiesMetadata, statesMetadata] = await Promise.all([
      getCountiesMetadata(),
      getStatesMetadata()
    ]);
    return countiesMetadata.concat(statesMetadata);
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

  var input = document.querySelector('textarea[name=tags2]'),
  tagify = new Tagify(input, {
      enforceWhitelist : true,
      delimiters       : null,
      whitelist        : ["The Shawshank Redemption", "The Godfather", "The Godfather: Part II", "The Dark Knight", "12 Angry Men", "Schindler's List", "Pulp Fiction", "The Lord of the Rings: The Return of the King", "The Good, the Bad and the Ugly", "Fight Club", "The Lord of the Rings: The Fellowship of the Ring", "Star Wars: Episode V - The Empire Strikes Back", "Forrest Gump", "Inception", "The Lord of the Rings: The Two Towers", "One Flew Over the Cuckoo's Nest", "Goodfellas", "The Matrix", "Seven Samurai", "Star Wars: Episode IV - A New Hope", "City of God", "Se7en", "The Silence of the Lambs", "It's a Wonderful Life", "The Usual Suspects", "Life Is Beautiful", "Léon: The Professional", "Spirited Away", "Saving Private Ryan", "La La Land", "Once Upon a Time in the West", "American History X", "Interstellar", "Casablanca", "Psycho", "City Lights", "The Green Mile", "Raiders of the Lost Ark", "The Intouchables", "Modern Times", "Rear Window", "The Pianist", "The Departed", "Terminator 2: Judgment Day", "Back to the Future", "Whiplash", "Gladiator", "Memento", "Apocalypse Now", "The Prestige", "The Lion King", "Alien", "Dr. Strangelove or: How I Learned to Stop Worrying and Love the Bomb", "Sunset Boulevard", "The Great Dictator", "Cinema Paradiso", "The Lives of Others", "Paths of Glory", "Grave of the Fireflies", "Django Unchained", "The Shining", "WALL·E", "American Beauty", "The Dark Knight Rises", "Princess Mononoke", "Aliens", "Oldboy", "Once Upon a Time in America", "Citizen Kane", "Das Boot", "Witness for the Prosecution", "North by Northwest", "Vertigo", "Star Wars: Episode VI - Return of the Jedi", "Reservoir Dogs", "M", "Braveheart", "Amélie", "Requiem for a Dream", "A Clockwork Orange", "Taxi Driver", "Lawrence of Arabia", "Like Stars on Earth", "Double Indemnity", "To Kill a Mockingbird", "Eternal Sunshine of the Spotless Mind", "Toy Story 3", "Amadeus", "My Father and My Son", "Full Metal Jacket", "The Sting", "2001: A Space Odyssey", "Singin' in the Rain", "Bicycle Thieves", "Toy Story", "Dangal", "The Kid", "Inglourious Basterds", "Snatch", "Monty Python and the Holy Grail", "Hacksaw Ridge", "3 Idiots", "L.A. Confidential", "For a Few Dollars More", "Scarface", "Rashomon", "The Apartment", "The Hunt", "Good Will Hunting", "Indiana Jones and the Last Crusade", "A Separation", "Metropolis", "Yojimbo", "All About Eve", "Batman Begins", "Up", "Some Like It Hot", "The Treasure of the Sierra Madre", "Unforgiven", "Downfall", "Raging Bull", "The Third Man", "Die Hard", "Children of Heaven", "The Great Escape", "Heat", "Chinatown", "Inside Out", "Pan's Labyrinth", "Ikiru", "My Neighbor Totoro", "On the Waterfront", "Room", "Ran", "The Gold Rush", "The Secret in Their Eyes", "The Bridge on the River Kwai", "Blade Runner", "Mr. Smith Goes to Washington", "The Seventh Seal", "Howl's Moving Castle", "Lock, Stock and Two Smoking Barrels", "Judgment at Nuremberg", "Casino", "The Bandit", "Incendies", "A Beautiful Mind", "A Wednesday", "The General", "The Elephant Man", "Wild Strawberries", "Arrival", "V for Vendetta", "Warrior", "The Wolf of Wall Street", "Manchester by the Sea", "Sunrise", "The Passion of Joan of Arc", "Gran Torino", "Rang De Basanti", "Trainspotting", "Dial M for Murder", "The Big Lebowski", "The Deer Hunter", "Tokyo Story", "Gone with the Wind", "Fargo", "Finding Nemo", "The Sixth Sense", "The Thing", "Hera Pheri", "Cool Hand Luke", "Andaz Apna Apna", "Rebecca", "No Country for Old Men", "How to Train Your Dragon", "Munna Bhai M.B.B.S.", "Sholay", "Kill Bill: Vol. 1", "Into the Wild", "Mary and Max", "Gone Girl", "There Will Be Blood", "Come and See", "It Happened One Night", "Life of Brian", "Rush", "Hotel Rwanda", "Platoon", "Shutter Island", "Network", "The Wages of Fear", "Stand by Me", "Wild Tales", "In the Name of the Father", "Spotlight", "Star Wars: The Force Awakens", "The Nights of Cabiria", "The 400 Blows", "Butch Cassidy and the Sundance Kid", "Mad Max: Fury Road", "The Maltese Falcon", "12 Years a Slave", "Ben-Hur", "The Grand Budapest Hotel", "Persona", "Million Dollar Baby", "Amores Perros", "Jurassic Park", "The Princess Bride", "Hachi: A Dog's Tale", "Memories of Murder", "Stalker", "Nausicaä of the Valley of the Wind", "Drishyam", "The Truman Show", "The Grapes of Wrath", "Before Sunrise", "Touch of Evil", "Annie Hall", "The Message", "Rocky", "Gandhi", "Harry Potter and the Deathly Hallows: Part 2", "The Bourne Ultimatum", "Diabolique", "Donnie Darko", "Monsters, Inc.", "Prisoners", "8½", "The Terminator", "The Wizard of Oz", "Catch Me If You Can", "Groundhog Day", "Twelve Monkeys", "Zootopia", "La Haine", "Barry Lyndon", "Jaws", "The Best Years of Our Lives", "Infernal Affairs", "Udaan", "The Battle of Algiers", "Strangers on a Train", "Dog Day Afternoon", "Sin City", "Kind Hearts and Coronets", "Gangs of Wasseypur", "The Help"],
      callbacks        : {
          add    : console.log,  // callback when adding a tag
          remove : console.log   // callback when removing a tag
      }
  });

  (async () => {
    const regionsDataRequests = requestedRegions.map((requestedRegion) => {
      if (requestedRegion.length === 1) {
        return getStateData(requestedRegion[0]);
      } else if (requestedRegion.length === 2) {
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
    // console.log({ countyPopulationRows });
    countyPopulationRows.forEach(([county, state, pop]) => {
      populations[state].counties[county] = +pop.split(",").join("");
    });

    const regionRows = newRegionRows;

    // console.log({ regionRows });

    const byDay = _.groupBy(regionRows, (row) => row[0]);

    const days = Object.keys(byDay).sort();
    const dateRange = [days[0], days[days.length - 1]].map((day) => {
      return `<b>${day}</b>`;
      // return dateFns.format(dateFns.parseISO(day), 'MMM D y');
    });
    document.querySelector(
      ".date-range"
    ).innerHTML = `${dateRange[0]} to ${dateRange[1]}`;

    const byRegion = rows2smoothDailyRateByRegion(regionRows, populations);
    // console.log({ byRegion });

    const displaySet = { byRegion, byDay };
    // console.log({ displaySet });

    const highchartsSeries = set2highcharts(displaySet);
    // debugger;
    // console.log({ highchartsSeries });

    Highcharts.chart(chartContainer, {
      xAxis: {
        type: "datetime",
        labels: {
          autoRotation: false,
        },
        // min: new Date('2020-03-01').getTime()
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
  })();
}
