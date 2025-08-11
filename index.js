(function () {
  // Shortcut for document.querySelector
  const $ = (sel) => document.querySelector(sel)
  
  // DOM elements references
  const cityInput = $('#city-input')
  const searchBtn = $('#search-btn')
  const locateBtn = $('#locate-btn')
  const unitToggle = $('#unit-toggle')
  const recentWrapper = $('#recent-wrapper')
  const recentSelect = $('#recent-select')

  const todayTitle = $('#today-title')
  const todayIcon = $('#today-icon')
  const todayTemp = $('#today-temp')
  const todaySummary = $('#today-summary')
  const todayRange = $('#today-range')
  const todayWind = $('#today-wind')
  const todayHumidity = $('#today-humidity')
  const forecastGrid = $('#forecast-grid')

  // Local storage key to save recent cities
  const LS_RECENT_KEY = 'recentCities' // shared with React app
  
  // Variables to hold state
  let currentLocation = null
  let weather = null
  let unitF = false   // false = Celsius, true = Fahrenheit
  let loading = false

  // Simple toast notification helper
  function toast({ title, description, variant = 'default' }) {
    const root = document.getElementById('toast-root')
    const el = document.createElement('div')
    el.className = `toast ${variant === 'destructive' ? 'toast--destructive' : ''}`
    el.innerHTML = `<strong class="block">${title}</strong>${description ? `<div class="text-sm">${description}</div>` : ''}`
    root.appendChild(el)
    // Remove toast after 3.5 seconds
    setTimeout(() => { el.remove(); }, 3500)
  }

  // Utility to convert Celsius to Fahrenheit
  const cToF = (c) => (c * 9) / 5 + 32

  // Check if weather code indicates rainy weather
  const isRainyCode = (code) => 
    (code >= 51 && code <= 67) || (code >= 80 && code <= 99) || code === 61 || code === 63 || code === 65

  // Convert weather code to human-readable summary
  function codeToSummary(code) {
    if (code === 0) return 'Clear'
    if (code === 1 || code === 2 || code === 3) return 'Partly cloudy'
    if (code === 45 || code === 48) return 'Fog'
    if (code >= 51 && code <= 57) return 'Drizzle'
    if ([61, 63, 65, 80, 81, 82].includes(code)) return 'Rain'
    if ([66, 67].includes(code)) return 'Freezing rain'
    if ([71, 73, 75, 77, 85, 86].includes(code)) return 'Snow'
    if ([95, 96, 99].includes(code)) return 'Thunderstorm'
    return 'Unknown'
  }

  // API call to get latitude & longitude by city name
  async function geocodeCity(query) {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`
    const res = await fetch(url)
    if (!res.ok) throw new Error('Geocoding failed')
    const data = await res.json()
    const r = data?.results?.[0]
    if (!r) return null
    return { name: r.name, country: r.country, latitude: r.latitude, longitude: r.longitude }
  }

  // API call to get city info by coordinates (reverse geocoding)
  async function reverseGeocode(latitude, longitude) {
    const url = `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${latitude}&longitude=${longitude}&count=1&language=en&format=json`
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()
    const r = data?.results?.[0]
    if (!r) return null
    return { name: r.name, country: r.country, latitude, longitude }
  }

  // Fetch weather data from open-meteo API by coordinates
  async function fetchWeather(latitude, longitude) {
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      timezone: 'auto',
      current_weather: 'true',
      hourly: ['temperature_2m', 'relativehumidity_2m', 'windspeed_10m', 'weathercode'].join(','),
      daily: ['temperature_2m_max', 'temperature_2m_min', 'weathercode', 'windspeed_10m_max', 'precipitation_sum'].join(',')
    })
    const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`
    const res = await fetch(url)
    if (!res.ok) throw new Error('Weather API failed')
    const data = await res.json()

    // Extract current time and hourly data arrays
    const currentTime = data.current_weather?.time
    const hourlyTimes = data.hourly?.time ?? []
    const humHourly = data.hourly?.relativehumidity_2m ?? []
    const wsHourly = data.hourly?.windspeed_10m ?? []

    let humidityNow = 0
    let windNow = data.current_weather?.windspeed ?? 0
    // Find humidity and wind speed for the current time from hourly data
    if (currentTime && hourlyTimes.length && humHourly.length) {
      const idx = hourlyTimes.indexOf(currentTime)
      if (idx >= 0) humidityNow = humHourly[idx]
    }
    if (currentTime && hourlyTimes.length && wsHourly.length) {
      const idx = hourlyTimes.indexOf(currentTime)
      if (idx >= 0) windNow = wsHourly[idx]
    }

    // Prepare current weather object
    const current = {
      temperatureC: data.current_weather?.temperature ?? 0,
      windKmh: windNow,
      humidity: humidityNow,
      weatherCode: data.current_weather?.weathercode ?? 0,
    }

    // Extract daily forecast data arrays
    const dailyDates = data.daily?.time ?? []
    const windDailyMax = data.daily?.windspeed_10m_max ?? []
    const tempMax = data.daily?.temperature_2m_max ?? []
    const tempMin = data.daily?.temperature_2m_min ?? []
    const wCodes = data.daily?.weathercode ?? []

    // Calculate average humidity per day from hourly data
    const humidityByDay = {}
    for (let i = 0; i < hourlyTimes.length; i++) {
      const d = hourlyTimes[i]?.slice(0, 10)
      const h = humHourly[i] ?? 0
      if (!d) continue
      if (!humidityByDay[d]) humidityByDay[d] = { sum: 0, count: 0 }
      humidityByDay[d].sum += h
      humidityByDay[d].count += 1
    }

    // Build daily forecast array with relevant data
    const daily = dailyDates.map((date, i) => ({
      date,
      maxC: tempMax[i] ?? 0,
      minC: tempMin[i] ?? 0,
      windKmh: windDailyMax[i] ?? 0,
      humidity: humidityByDay[date] ? Math.round(humidityByDay[date].sum / Math.max(humidityByDay[date].count, 1)) : 0,
      weatherCode: wCodes[i] ?? 0,
    }))

    // Return current weather and 5-day forecast
    return { current, daily: daily.slice(0, 5) }
  }

  // Toggle UI loading state for buttons
  function setLoading(isLoading) {
    loading = isLoading
    searchBtn.disabled = isLoading
    locateBtn.disabled = isLoading
    searchBtn.classList.toggle('opacity-60', isLoading)
    locateBtn.classList.toggle('opacity-60', isLoading)
  }

  // Save recent city in localStorage, keeping max 6 entries, most recent first
  function saveRecent(loc) {
    try {
      const prev = JSON.parse(localStorage.getItem(LS_RECENT_KEY) || '[]')
      // Remove duplicate entries of the same city
      const filtered = prev.filter((c) => c.name !== loc.name)
      const next = [loc, ...filtered].slice(0, 6)
      localStorage.setItem(LS_RECENT_KEY, JSON.stringify(next))
      renderRecent(next)
    } catch (_) {}
  }

  // Render recent cities dropdown UI
  function renderRecent(list) {
    if (Array.isArray(list) && list.length > 0) {
      recentWrapper.classList.remove('hidden')
      recentSelect.innerHTML = ''
      list.forEach((c, idx) => {
        const opt = document.createElement('option')
        opt.value = String(idx)
        opt.textContent = `${c.name}${c.country ? ` (${c.country})` : ''}`
        opt.dataset.lat = c.latitude
        opt.dataset.lon = c.longitude
        recentSelect.appendChild(opt)
      })
    } else {
      // Hide if no recent cities saved
      recentWrapper.classList.add('hidden')
      recentSelect.innerHTML = ''
    }
  }

  // Change background if current weather is rainy
  function applyBackground(code) {
    const root = document.body
    if (isRainyCode(code)) {
      root.classList.add('rainy-bg')
    } else {
      root.classList.remove('rainy-bg')
    }
  }

  // Render weather info on the UI
  function renderWeather() {
    if (!weather) {
      // Reset UI if no data
      todayTitle.textContent = 'Today'
      todayTemp.textContent = '--°C'
      todaySummary.textContent = ''
      todayRange.textContent = '--° / --°C'
      todayWind.textContent = '-- km/h'
      todayHumidity.textContent = '--%'
      forecastGrid.innerHTML = ''
      return
    }

    // Show current location name and country
    if (currentLocation) {
      todayTitle.textContent = `${currentLocation.name}${currentLocation.country ? ', ' + currentLocation.country : ''}`
    } else {
      todayTitle.textContent = 'Today'
    }

    // Update background for rainy weather
    applyBackground(weather.current.weatherCode)

    // Display temperature, summary and other details
    const c = weather.current.temperatureC
    const displayTemp = unitF ? Math.round(cToF(c)) + '°F' : Math.round(c) + '°C'
    todayTemp.textContent = displayTemp
    todaySummary.textContent = codeToSummary(weather.current.weatherCode)

    const maxC = Math.round(weather.daily[0]?.maxC ?? c)
    const minC = Math.round(weather.daily[0]?.minC ?? c)
    todayRange.textContent = `${maxC}° / ${minC}°C`
    todayWind.textContent = `${Math.round(weather.current.windKmh)} km/h`
    todayHumidity.textContent = `${Math.round(weather.current.humidity)}%`

    // Show weather icon as emoji
    const wc = weather.current.weatherCode
    const emoji = isRainyCode(wc) ? '🌧️' : wc === 0 ? '☀️' : '⛅'
    todayIcon.textContent = emoji

    // Render 5-day forecast cards
    forecastGrid.innerHTML = ''
    weather.daily.forEach((d) => {
      const card = document.createElement('div')
      card.className = 'rounded-lg border p-4 bg-white hover:-translate-y-0.5 transition-transform'
      const day = new Date(d.date).toLocaleDateString(undefined, { weekday: 'short' })
      const em = isRainyCode(d.weatherCode) ? '🌧️' : d.weatherCode === 0 ? '☀️' : '⛅'
      card.innerHTML = `
        <div class="flex items-center justify-between mb-2">
          <span class="text-sm text-slate-600">${day}</span>
          <span aria-hidden="true">${em}</span>
        </div>
        <div class="text-lg font-semibold mb-1">${Math.round(d.maxC)}° / ${Math.round(d.minC)}°C</div>
        <div class="flex items-center gap-2 text-sm text-slate-600"><span>🌬️</span>${Math.round(d.windKmh)} km/h</div>
        <div class="flex items-center gap-2 text-sm text-slate-600"><span>💧</span>${Math.round(d.humidity)}%</div>
      `
      forecastGrid.appendChild(card)
    })
  }

  // Handle searching weather by city input
  async function doSearch() {
    const q = cityInput.value.trim()
    if (!q) {
      toast({ title: 'Enter a city name', description: 'Please type a city to search.' })
      return
    }
    try {
      setLoading(true)
      // Get coordinates for city
      const loc = await geocodeCity(q)
      if (!loc) {
        toast({ title: 'City not found', description: 'Try another search.', variant: 'destructive' })
        return
      }
      currentLocation = loc
      // Fetch weather data for coordinates
      const data = await fetchWeather(loc.latitude, loc.longitude)
      weather = data
      renderWeather()
      saveRecent(loc)

      // Warn if temperature is extremely hot
      if (data.current.temperatureC > 40) {
        toast({ title: 'Heat alert', description: 'Extreme temperature detected for today.', variant: 'destructive' })
      }
    } catch (e) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'Failed to fetch weather.', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  // Handle weather fetch by user's current geolocation
  async function useLocation() {
    if (!('geolocation' in navigator)) {
      toast({ title: 'Geolocation unsupported', description: 'Your browser does not support location.', variant: 'destructive' })
      return
    }
    setLoading(true)
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        const { latitude, longitude } = pos.coords
        // Try to get city name by reverse geocoding coordinates
        const loc = (await reverseGeocode(latitude, longitude)) || { name: 'Current Location', latitude, longitude }
        currentLocation = loc
        const data = await fetchWeather(latitude, longitude)
        weather = data
        renderWeather()
        if (data.current.temperatureC > 40) {
          toast({ title: 'Heat alert', description: 'Extreme temperature detected for today.', variant: 'destructive' })
        }
      } catch (e) {
        toast({ title: 'Error', description: e instanceof Error ? e.message : 'Failed to fetch location weather.', variant: 'destructive' })
      } finally {
        setLoading(false)
      }
    }, (err) => {
      setLoading(false)
      toast({ title: 'Location error', description: err.message, variant: 'destructive' })
    })
  }

  // Event listeners
  searchBtn.addEventListener('click', doSearch)
  cityInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch() })
  locateBtn.addEventListener('click', useLocation)
  unitToggle.addEventListener('change', (e) => {
    unitF = e.target.checked  // Toggle between Celsius and Fahrenheit
    renderWeather()
  })
  recentSelect.addEventListener('change', async () => {
    try {
      const idx = recentSelect.selectedIndex
      const list = JSON.parse(localStorage.getItem(LS_RECENT_KEY) || '[]')
      const city = list[idx]
      if (!city) return
      currentLocation = city
      setLoading(true)
      const data = await fetchWeather(city.latitude, city.longitude)
      weather = data
      renderWeather()
      if (data.current.temperatureC > 40) {
        toast({ title: 'Heat alert', description: 'Extreme temperature detected for today.', variant: 'destructive' })
      }
    } catch (e) {
      toast({ title: 'Error', description: 'Failed to fetch weather.', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  })

  // Initialize recent cities from localStorage on load
  try {
    const list = JSON.parse(localStorage.getItem(LS_RECENT_KEY) || '[]')
    renderRecent(list)
  } catch (_) {}

  // Initial render of weather UI (empty)
  renderWeather()
})()
