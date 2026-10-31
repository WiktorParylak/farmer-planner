-- Farmer Planner Link
-- Writes what the Farmer Planner app needs from a running game to
-- modSettings/FS25_FarmerPlannerLink/savegame<N>/ every few seconds:
--   fields_<slot>.xml    the game's own fields.xml format (FieldManager)
--   farmland_<slot>.xml  the game's own farmland.xml format (FarmlandManager)
--   live.xml             header, weather, input prices, harvest scale,
--                        stones per field and the farm's production recipes
-- Fields and farmland alternate between slots "a" and "b"; live.xml is written
-- last and names the slot that is complete, so the app never reads a file the
-- game is still writing. The mod only reads the game.

FarmerPlannerLink = {}
FarmerPlannerLink.FORMAT_VERSION = 1
FarmerPlannerLink.WRITE_INTERVAL = 5000      -- ms of game frames
FarmerPlannerLink.STONES_EVERY = 6           -- writes between stone scans (~30 s)
FarmerPlannerLink.modName = g_currentModName
FarmerPlannerLink.modVersion = "1.0.0.0"

local FPL = FarmerPlannerLink

function FPL:loadMap(name)
    self.timer = 0
    self.counter = 0
    self.slot = "b"
    self.stones = nil
    self.errors = {}
end

function FPL:deleteMap()
    self.stones = nil
end

function FPL:update(dt)
    if g_currentMission == nil or g_currentMission.missionInfo == nil or g_currentMission.environment == nil then
        return
    end
    self.timer = (self.timer or 0) + dt
    if self.timer < FPL.WRITE_INTERVAL then
        return
    end
    self.timer = 0
    self:safe("write", self.writeAll, self)
end

-- One failing section must not stop the rest; each error is logged once.
function FPL:safe(label, fn, ...)
    local ok, result = pcall(fn, ...)
    if not ok then
        if not self.errors[label] then
            self.errors[label] = true
            Logging.warning("FarmerPlannerLink: %s failed: %s", label, tostring(result))
        end
        return nil
    end
    return result
end

function FPL:getDirectory()
    local index = g_currentMission.missionInfo.savegameIndex
    if index == nil then
        return nil
    end
    local base = getUserProfileAppPath() .. "modSettings/"
    createFolder(base)
    base = base .. "FS25_FarmerPlannerLink/"
    createFolder(base)
    local dir = base .. "savegame" .. tostring(index) .. "/"
    createFolder(dir)
    return dir
end

function FPL:getFarmId()
    local farmId = g_currentMission:getFarmId()
    if farmId == nil or farmId == 0 then
        farmId = 1
    end
    return farmId
end

function FPL:writeAll()
    local dir = self:getDirectory()
    if dir == nil then
        return
    end
    self.counter = self.counter + 1
    local slot = self.slot == "a" and "b" or "a"

    local fieldsOk = self:safe("fields", function()
        g_fieldManager:saveToXMLFile(dir .. "fields_" .. slot .. ".xml")
        return true
    end)
    local farmlandOk = self:safe("farmland", function()
        return g_farmlandManager:saveToXMLFile(dir .. "farmland_" .. slot .. ".xml") ~= false
    end)

    if self.stones == nil or self.counter % FPL.STONES_EVERY == 1 then
        self.stones = self:safe("stones", self.scanStones, self) or self.stones
    end

    local xmlFile = createXMLFile("farmerPlannerLink", dir .. "live.xml", "farmerPlannerLink")
    if xmlFile == nil or xmlFile == 0 then
        return
    end
    self:safe("header", self.writeHeader, self, xmlFile, (fieldsOk and farmlandOk) and slot or self.slot)
    self:safe("weather", self.writeWeather, self, xmlFile)
    self:safe("prices", self.writePrices, self, xmlFile)
    self:safe("harvestScale", self.writeHarvestScale, self, xmlFile)
    self:safe("stonesXml", self.writeStones, self, xmlFile)
    self:safe("productions", self.writeProductions, self, xmlFile)
    saveXMLFile(xmlFile)
    delete(xmlFile)

    if fieldsOk and farmlandOk then
        self.slot = slot
    end
end

function FPL:writeHeader(xmlFile, slot)
    local mission = g_currentMission
    local env = mission.environment
    local k = "farmerPlannerLink"
    setXMLInt(xmlFile, k .. "#format", FPL.FORMAT_VERSION)
    setXMLString(xmlFile, k .. "#modVersion", FPL.modVersion)
    setXMLInt(xmlFile, k .. "#savegameIndex", mission.missionInfo.savegameIndex or 0)
    setXMLInt(xmlFile, k .. "#farmId", self:getFarmId())
    setXMLInt(xmlFile, k .. "#counter", self.counter)
    setXMLString(xmlFile, k .. "#slot", slot)
    setXMLString(xmlFile, k .. "#mapTitle", tostring(mission.missionInfo.mapTitle or ""))
    setXMLBool(xmlFile, k .. "#isServer", mission:getIsServer() == true)

    local t = k .. ".time"
    setXMLInt(xmlFile, t .. "#monotonicDay", env.currentMonotonicDay or 0)
    setXMLInt(xmlFile, t .. "#day", env.currentDay or 0)
    setXMLInt(xmlFile, t .. "#period", env.currentPeriod or 0)
    setXMLInt(xmlFile, t .. "#dayInPeriod", env.currentDayInPeriod or 0)
    setXMLInt(xmlFile, t .. "#daysPerPeriod", env.daysPerPeriod or 0)
    setXMLFloat(xmlFile, t .. "#dayTime", env.dayTime or 0)
    setXMLFloat(xmlFile, t .. "#timeScale", mission.missionInfo.timeScale or 1)
end

function FPL:writeWeather(xmlFile)
    local weather = g_currentMission.environment.weather
    if weather == nil then
        return
    end
    local k = "farmerPlannerLink.weather"
    if weather.getCurrentTemperature ~= nil then
        setXMLFloat(xmlFile, k .. "#temperature", weather:getCurrentTemperature() or 0)
    end
    if weather.getIsRaining ~= nil then
        setXMLBool(xmlFile, k .. "#isRaining", weather:getIsRaining() == true)
    end
    if weather.getRainFallScale ~= nil then
        setXMLFloat(xmlFile, k .. "#rainFallScale", weather:getRainFallScale() or 0)
    end
    if weather.getTimeSinceLastRain ~= nil then
        setXMLFloat(xmlFile, k .. "#timeSinceLastRain", weather:getTimeSinceLastRain() or 0)
    end
    if weather.getGroundWetness ~= nil then
        setXMLFloat(xmlFile, k .. "#groundWetness", weather:getGroundWetness() or 0)
    end
end

-- What the game charges per litre when you buy a fill type (seeds, fertilizer,
-- lime, herbicide...), with the economic difficulty already applied.
function FPL:writePrices(xmlFile)
    local economy = g_currentMission.economyManager
    if economy == nil then
        return
    end
    local i = 0
    for _, fillType in ipairs(g_fillTypeManager:getFillTypes()) do
        local price = economy:getPricePerLiter(fillType.index)
        if price ~= nil and price > 0 then
            local k = string.format("farmerPlannerLink.prices.fillType(%d)", i)
            setXMLString(xmlFile, k .. "#name", fillType.name)
            setXMLFloat(xmlFile, k .. "#pricePerLiter", price)
            i = i + 1
        end
    end
end

-- The game's yield multiplier, measured for each fruit: all factors at 1, then
-- one factor at a time lowered. The app turns a field's levels into factors
-- and combines them with these numbers.
local HARVEST_PROBES = {
    { "full",    1,   1, 1, 1, 1, 1 },
    { "spray0",  0,   1, 1, 1, 1, 1 },
    { "spray05", 0.5, 1, 1, 1, 1, 1 },
    { "plow0",   1,   0, 1, 1, 1, 1 },
    { "lime0",   1,   1, 0, 1, 1, 1 },
    { "weed0",   1,   1, 1, 0, 1, 1 },
    { "stubble0", 1,  1, 1, 1, 0, 1 },
    { "roller0", 1,   1, 1, 1, 1, 0 }
}

function FPL:writeHarvestScale(xmlFile)
    local mission = g_currentMission
    if mission.getHarvestScaleMultiplier == nil then
        return
    end
    local i = 0
    for _, fruitType in ipairs(g_fruitTypeManager:getFruitTypes()) do
        local k = string.format("farmerPlannerLink.harvestScale.fruit(%d)", i)
        setXMLString(xmlFile, k .. "#name", fruitType.name)
        for _, probe in ipairs(HARVEST_PROBES) do
            local value = mission:getHarvestScaleMultiplier(fruitType.index, probe[2], probe[3], probe[4], probe[5], probe[6], probe[7], 0)
            if value ~= nil then
                setXMLFloat(xmlFile, k .. "#" .. probe[1], value)
            end
        end
        i = i + 1
    end
end

-- Share of each owned field still covered with stones (0..1), from the
-- game's stone density map.
function FPL:scanStones()
    local mission = g_currentMission
    local stoneSystem = mission.stoneSystem
    if stoneSystem == nil or stoneSystem.getMapHasStones == nil or not stoneSystem:getMapHasStones() then
        return {}
    end
    local mapId, firstChannel, numChannels = stoneSystem:getDensityMapData()
    local minValue, maxValue = stoneSystem:getMinMaxValues()
    if mapId == nil or minValue == nil then
        return {}
    end
    local modifier = DensityMapModifier.new(mapId, firstChannel, numChannels, g_terrainNode)
    local filter = DensityMapFilter.new(modifier)
    filter:setValueCompareParams(DensityValueCompareType.BETWEEN, minValue, maxValue)

    local farmId = self:getFarmId()
    local result = {}
    for _, field in ipairs(g_fieldManager:getFields()) do
        local farmland = field.farmland
        local id = field:getId()
        if id ~= nil and farmland ~= nil and g_farmlandManager:getFarmlandOwner(farmland.id) == farmId then
            local polygon = field:getDensityMapPolygon()
            if polygon ~= nil then
                polygon:applyToModifier(modifier)
                local _, area, totalArea = modifier:executeGet(filter)
                if totalArea ~= nil and totalArea > 0 then
                    table.insert(result, { id = id, share = area / totalArea })
                end
            end
        end
    end
    return result
end

function FPL:writeStones(xmlFile)
    if self.stones == nil then
        return
    end
    setXMLBool(xmlFile, "farmerPlannerLink.stones#enabled", true)
    for i, entry in ipairs(self.stones) do
        local k = string.format("farmerPlannerLink.stones.field(%d)", i - 1)
        setXMLInt(xmlFile, k .. "#id", entry.id)
        setXMLFloat(xmlFile, k .. "#share", entry.share)
    end
end

-- Recipes of the farm's production points, including the base game ones the
-- app cannot read (they live in the game's packed data).
function FPL:writeProductions(xmlFile)
    local manager = g_currentMission.productionChainManager
    if manager == nil or manager.getProductionPointsForFarmId == nil then
        return
    end
    local i = 0
    for _, point in ipairs(manager:getProductionPointsForFarmId(self:getFarmId())) do
        local placeable = point.owningPlaceable
        local k = string.format("farmerPlannerLink.productions.production(%d)", i)
        if placeable ~= nil then
            setXMLString(xmlFile, k .. "#filename", tostring(placeable.configFileName or ""))
            if placeable.getName ~= nil then
                setXMLString(xmlFile, k .. "#name", tostring(placeable:getName() or ""))
            end
            if placeable.getUniqueId ~= nil then
                setXMLString(xmlFile, k .. "#uniqueId", tostring(placeable:getUniqueId() or ""))
            end
        end
        local active = {}
        for _, production in ipairs(point.activeProductions or {}) do
            active[production.id] = true
        end
        for j, production in ipairs(point.productions or {}) do
            local rk = string.format("%s.recipe(%d)", k, j - 1)
            setXMLString(xmlFile, rk .. "#id", tostring(production.id or ""))
            setXMLFloat(xmlFile, rk .. "#cyclesPerMonth", production.cyclesPerMonth or 0)
            setXMLBool(xmlFile, rk .. "#enabled", active[production.id] == true)
            for n, input in ipairs(production.inputs or {}) do
                local ik = string.format("%s.input(%d)", rk, n - 1)
                setXMLString(xmlFile, ik .. "#fillType", tostring(g_fillTypeManager:getFillTypeNameByIndex(input.type) or ""))
                setXMLFloat(xmlFile, ik .. "#amount", input.amount or 0)
            end
            for n, output in ipairs(production.outputs or {}) do
                local ok = string.format("%s.output(%d)", rk, n - 1)
                setXMLString(xmlFile, ok .. "#fillType", tostring(g_fillTypeManager:getFillTypeNameByIndex(output.type) or ""))
                setXMLFloat(xmlFile, ok .. "#amount", output.amount or 0)
            end
        end
        i = i + 1
    end
end

addModEventListener(FarmerPlannerLink)
