-- Farmer Planner Link
-- Tells the Farmer Planner app what a running game looks like, through three
-- small files of its own in modSettings/FS25_FarmerPlannerLink/savegame<N>/:
--   live.xml    the heartbeat: time and weather, every 10 s
--   fields.xml  one row per owned field, only when something on them changed
--   data.xml    input prices, yield factors and recipes, only when they changed
--
-- It stays out of the game's way:
--   * it only reads: no game function is replaced, no event is sent, nothing is
--     added to the savegame, and the field state it reads is its own copy
--   * one field per step, so a farm of any size never costs a whole frame
--   * nothing goes to disk while the game saves, and nothing unchanged at all
--   * a section that fails is logged once and named in live.xml; the rest goes on
--
-- A file can be read part-way through writing: the app skips one it can't parse
-- and keeps the last good one. Each file names the game session that wrote it,
-- so files left by an earlier game are never taken for this one.

FarmerPlannerLink = {}
local FPL = FarmerPlannerLink

FPL.FORMAT_VERSION = 2               -- keep the same as LIVE_LINK_FORMAT in live-link.js
FPL.modVersion = "2.0.0.0"
FPL.HEARTBEAT_MS = 10000
FPL.SWEEP_MS = 15000                 -- all owned fields, spread over this long
FPL.MIN_STEP_MS = 100                -- at most this often, however many fields
FPL.MAX_STEP_MS = 1000
FPL.SLOW_MS = 60000                  -- prices and recipes
FPL.SCALE_EVERY = 5                  -- yield factors, in rounds of SLOW_MS
FPL.SHARE_STEP = 20                  -- harvested share in 5 % steps: not every swath is news

function FPL:loadMap(name)
    self.heartbeatTimer = FPL.HEARTBEAT_MS
    self.stepTimer = 0
    self.stepMs = FPL.MIN_STEP_MS
    self.slowTimer = FPL.SLOW_MS
    self.slowRound = 0
    self.counter = 0
    self.fieldsRev = 0
    self.dataRev = 0
    self.fieldsSig = nil
    self.dataSig = nil
    self.scaleItems = nil
    self.sweep = nil
    self.dir = nil
    self.session = nil
    self.fieldState = nil
    self.stoneQuery = nil
    self.fruitQueries = {}
    self.errors = {}
    self.errorNames = {}
end

function FPL:deleteMap()
    self.errors = nil                -- update does nothing until the next loadMap
    self.sweep = nil
    self.fieldState = nil
    self.stoneQuery = nil
    self.fruitQueries = nil
    self.scaleItems = nil
end

function FPL:update(dt)
    local mission = g_currentMission
    if mission == nil or mission.missionInfo == nil or mission.environment == nil or self.errors == nil then
        return
    end
    -- The game's own save comes first.
    if g_inGameMenu ~= nil and g_inGameMenu.isSaving then
        return
    end
    if not mission.paused then
        self.stepTimer = self.stepTimer + dt
        if self.stepTimer >= self.stepMs then
            self.stepTimer = 0
            self:safe("fields", self.stepSweep, self)
        end
        self.slowTimer = self.slowTimer + dt
        if self.slowTimer >= FPL.SLOW_MS then
            self.slowTimer = 0
            self:safe("data", self.writeData, self)
        end
    end
    self.heartbeatTimer = self.heartbeatTimer + dt
    if self.heartbeatTimer >= FPL.HEARTBEAT_MS then
        self.heartbeatTimer = 0
        self:safe("live", self.writeLive, self)
    end
end

-- One failing section must not stop the rest; each error is logged once.
function FPL:safe(label, fn, ...)
    local ok, result = pcall(fn, ...)
    if not ok then
        if not self.errors[label] then
            self.errors[label] = true
            table.insert(self.errorNames, label)
            Logging.warning("FarmerPlannerLink: %s failed: %s", label, tostring(result))
        end
        return nil
    end
    return result
end

function FPL:getDirectory()
    if self.dir == nil then
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
        self.dir = dir
        self.session = tostring(getDate("%Y%m%d%H%M%S"))
    end
    return self.dir
end

function FPL:getFarmId()
    local farmId = g_currentMission:getFarmId()
    if farmId == nil or farmId == 0 then
        farmId = 1
    end
    return farmId
end

---------------------------------------------------------------------------
-- A file is first a list of values, so "has it changed" costs no disk work.

local function newDoc()
    return { items = {}, sig = {} }
end

local function put(doc, setter, key, value)
    if value == nil then
        return
    end
    table.insert(doc.items, { setter, key, value })
    if setter == "f" then
        table.insert(doc.sig, key .. "=" .. string.format("%.4f", value))
    else
        table.insert(doc.sig, key .. "=" .. tostring(value))
    end
end

local function append(doc, items)
    for _, item in ipairs(items) do
        put(doc, item[1], item[2], item[3])
    end
end

local function signature(doc)
    return table.concat(doc.sig, "|")
end

local function writeDoc(path, doc)
    local xmlFile = createXMLFile("farmerPlannerLink", path, "farmerPlannerLink")
    if xmlFile == nil or xmlFile == 0 then
        return false
    end
    for _, item in ipairs(doc.items) do
        local setter, key, value = item[1], item[2], item[3]
        if setter == "s" then
            setXMLString(xmlFile, key, value)
        elseif setter == "i" then
            setXMLInt(xmlFile, key, value)
        elseif setter == "f" then
            setXMLFloat(xmlFile, key, value)
        else
            setXMLBool(xmlFile, key, value)
        end
    end
    saveXMLFile(xmlFile)
    delete(xmlFile)
    return true
end

local ROOT = "farmerPlannerLink"

---------------------------------------------------------------------------
-- live.xml

function FPL:writeLive()
    local dir = self:getDirectory()
    if dir == nil then
        return
    end
    self.counter = self.counter + 1
    local mission = g_currentMission
    local env = mission.environment
    local doc = newDoc()
    put(doc, "i", ROOT .. "#format", FPL.FORMAT_VERSION)
    put(doc, "s", ROOT .. "#modVersion", FPL.modVersion)
    put(doc, "s", ROOT .. "#session", self.session)
    put(doc, "i", ROOT .. "#counter", self.counter)
    put(doc, "i", ROOT .. "#fieldsRev", self.fieldsRev)
    put(doc, "i", ROOT .. "#dataRev", self.dataRev)
    put(doc, "i", ROOT .. "#savegameIndex", mission.missionInfo.savegameIndex or 0)
    put(doc, "i", ROOT .. "#farmId", self:getFarmId())
    put(doc, "s", ROOT .. "#mapTitle", tostring(mission.missionInfo.mapTitle or ""))
    put(doc, "b", ROOT .. "#isServer", mission:getIsServer() == true)
    if #self.errorNames > 0 then
        put(doc, "s", ROOT .. "#errors", table.concat(self.errorNames, ","))
    end

    local t = ROOT .. ".time"
    put(doc, "i", t .. "#monotonicDay", env.currentMonotonicDay or 0)
    put(doc, "i", t .. "#day", env.currentDay or 0)
    put(doc, "i", t .. "#period", env.currentPeriod or 0)
    put(doc, "i", t .. "#dayInPeriod", env.currentDayInPeriod or 0)
    put(doc, "i", t .. "#daysPerPeriod", env.daysPerPeriod or 0)
    put(doc, "f", t .. "#dayTime", env.dayTime or 0)
    put(doc, "f", t .. "#timeScale", mission.missionInfo.timeScale or 1)

    self:safe("weather", self.addWeather, self, doc)
    writeDoc(dir .. "live.xml", doc)
end

function FPL:addWeather(doc)
    local weather = g_currentMission.environment.weather
    if weather == nil then
        return
    end
    local k = ROOT .. ".weather"
    if weather.getCurrentTemperature ~= nil then
        put(doc, "f", k .. "#temperature", weather:getCurrentTemperature() or 0)
    end
    if weather.getIsRaining ~= nil then
        put(doc, "b", k .. "#isRaining", weather:getIsRaining() == true)
    end
    if weather.getGroundWetness ~= nil then
        put(doc, "f", k .. "#groundWetness", weather:getGroundWetness() or 0)
    end
end

---------------------------------------------------------------------------
-- fields.xml: one field per step, the file once all have been read.

function FPL:stepSweep()
    if self.sweep == nil then
        self:beginSweep()
    end
    local sweep = self.sweep
    local field = sweep.fields[sweep.index]
    if field ~= nil then
        sweep.index = sweep.index + 1
        local row = self:safe("fieldRow", self.readField, self, field)
        table.insert(sweep.rows, row or { id = field:getId() })
    end
    if sweep.index > #sweep.fields then
        self.sweep = nil
        self:finishSweep(sweep)
    end
end

function FPL:beginSweep()
    local farmId = self:getFarmId()
    local fields = {}
    for _, field in ipairs(g_fieldManager:getFields()) do
        local farmland = field.farmland
        if field:getId() ~= nil and farmland ~= nil and g_farmlandManager:getFarmlandOwner(farmland.id) == farmId then
            table.insert(fields, field)
        end
    end
    self.sweep = { fields = fields, index = 1, rows = {} }
    self.stepMs = math.max(FPL.MIN_STEP_MS, math.min(FPL.MAX_STEP_MS, FPL.SWEEP_MS / math.max(#fields, 1)))
end

-- The field's state at one point, as the game's own fields.xml has it, on a
-- FieldState of our own: the field's cached one belongs to the game. The other
-- point is for a marker that happens to stand on a tramline, where nothing grows.
function FPL:sampleField(field)
    if self.fieldState == nil then
        self.fieldState = FieldState.new()
    end
    local state = self.fieldState
    local x, z = field:getIndicatorPosition()
    state:update(x, z)
    if not state.isValid or state.fruitTypeIndex == FruitType.UNKNOWN then
        local cx, cz = field:getCenterOfFieldWorldPosition()
        if cx ~= nil then
            state:update(cx, cz)
            if not state.isValid then
                state:update(x, z)
            end
        end
    end
    return state.isValid and state or nil
end

function FPL:readField(field)
    local row = { id = field:getId() }
    local state = self:sampleField(field)
    if state == nil then
        return row
    end
    local desc = g_fruitTypeManager:getFruitTypeByIndex(state.fruitTypeIndex)
    row.fruitType = desc ~= nil and desc.name or "UNKNOWN"
    row.growthState = state.growthState or 0
    row.weedState = state.weedState or 0
    row.groundType = FieldGroundType.getName(state.groundType) or ""
    row.sprayType = FieldSprayType.getName(state.sprayType) or ""
    row.sprayLevel = state.sprayLevel or 0
    row.limeLevel = state.limeLevel or 0
    row.plowLevel = state.plowLevel or 0
    row.rollerLevel = state.rollerLevel or 0
    row.stubbleShredLevel = state.stubbleShredLevel or 0
    row.stoneShare = self:safe("stones", self.readStoneShare, self, field)
    if desc ~= nil then
        row.cutShare = self:safe("cutShare", self.readCutShare, self, field, desc, row.growthState)
    end
    return row
end

function FPL:finishSweep(sweep)
    local dir = self:getDirectory()
    if dir == nil then
        return
    end
    local doc = newDoc()
    put(doc, "i", ROOT .. "#farmId", self:getFarmId())
    for i, row in ipairs(sweep.rows) do
        local k = string.format("%s.field(%d)", ROOT, i - 1)
        put(doc, "i", k .. "#id", row.id)
        put(doc, "s", k .. "#fruitType", row.fruitType)
        put(doc, "i", k .. "#growthState", row.growthState)
        put(doc, "i", k .. "#weedState", row.weedState)
        put(doc, "s", k .. "#groundType", row.groundType)
        put(doc, "s", k .. "#sprayType", row.sprayType)
        put(doc, "i", k .. "#sprayLevel", row.sprayLevel)
        put(doc, "i", k .. "#limeLevel", row.limeLevel)
        put(doc, "i", k .. "#rollerLevel", row.rollerLevel)
        put(doc, "i", k .. "#plowLevel", row.plowLevel)
        put(doc, "i", k .. "#stubbleShredLevel", row.stubbleShredLevel)
        put(doc, "f", k .. "#stoneShare", row.stoneShare)
        put(doc, "f", k .. "#cutShare", row.cutShare)
    end
    local sig = signature(doc)
    if sig == self.fieldsSig then
        return
    end
    self.fieldsRev = self.fieldsRev + 1
    put(doc, "s", ROOT .. "#session", self.session)
    put(doc, "i", ROOT .. "#rev", self.fieldsRev)
    if writeDoc(dir .. "fields.xml", doc) then
        self.fieldsSig = sig
        -- The app hears of it now, not at the next heartbeat.
        self.heartbeatTimer = FPL.HEARTBEAT_MS
    end
end

-- Share of the field still under stones (0..1), from the game's stone map.
-- Nil on a map without stones.
function FPL:readStoneShare(field)
    if self.stoneQuery == nil then
        self.stoneQuery = false
        local system = g_currentMission.stoneSystem
        if system ~= nil and system.getMapHasStones ~= nil and system:getMapHasStones() then
            local mapId, firstChannel, numChannels = system:getDensityMapData()
            local minValue, maxValue = system:getMinMaxValues()
            if mapId ~= nil and minValue ~= nil then
                local modifier = DensityMapModifier.new(mapId, firstChannel, numChannels, g_terrainNode)
                local filter = DensityMapFilter.new(modifier)
                filter:setValueCompareParams(DensityValueCompareType.BETWEEN, minValue, maxValue)
                self.stoneQuery = { modifier = modifier, filter = filter }
            end
        end
    end
    if not self.stoneQuery then
        return nil
    end
    local polygon = field:getDensityMapPolygon()
    if polygon == nil then
        return nil
    end
    polygon:applyToModifier(self.stoneQuery.modifier)
    local _, area, totalArea = self.stoneQuery.modifier:executeGet(self.stoneQuery.filter)
    if totalArea == nil or totalArea <= 0 then
        return nil
    end
    return area / totalArea
end

function FPL:getFruitQuery(desc)
    local query = self.fruitQueries[desc.index]
    if query == nil then
        query = false
        if desc.terrainDataPlaneId ~= nil and desc.getIsCut ~= nil and desc.getIsHarvestReady ~= nil then
            local modifier = DensityMapModifier.new(desc.terrainDataPlaneId, desc.startStateChannel, desc.numStateChannels, g_terrainNode)
            local count = 1
            for _ = 1, desc.numStateChannels do
                count = count * 2
            end
            local cut, ready = {}, {}
            for value = 1, count - 1 do
                if desc:getIsCut(value) then
                    table.insert(cut, value)
                elseif desc:getIsHarvestReady(value) then
                    table.insert(ready, value)
                end
            end
            query = { modifier = modifier, filter = DensityMapFilter.new(modifier), cut = cut, ready = ready }
        end
        self.fruitQueries[desc.index] = query
    end
    return query
end

-- How much of a ripe or part-harvested field is cut (0..1): one point can't
-- tell, as a harvester goes over it long before the field is done. Only asked
-- for fields in that state, nil for the others.
function FPL:readCutShare(field, desc, growthState)
    if desc.getIsCut == nil or desc.getIsHarvestReady == nil then
        return nil
    end
    if not desc:getIsCut(growthState) and not desc:getIsHarvestReady(growthState) then
        return nil
    end
    local query = self:getFruitQuery(desc)
    local polygon = field:getDensityMapPolygon()
    if not query or polygon == nil then
        return nil
    end
    polygon:applyToModifier(query.modifier)
    local function areaOf(values)
        local sum = 0
        for _, value in ipairs(values) do
            query.filter:setValueCompareParams(DensityValueCompareType.EQUAL, value)
            local _, area = query.modifier:executeGet(query.filter)
            sum = sum + (area or 0)
        end
        return sum
    end
    local cut = areaOf(query.cut)
    local total = cut + areaOf(query.ready)
    if total <= 0 then
        return nil
    end
    return math.floor(cut / total * FPL.SHARE_STEP + 0.5) / FPL.SHARE_STEP
end

---------------------------------------------------------------------------
-- data.xml: what rarely changes.

function FPL:writeData()
    local dir = self:getDirectory()
    if dir == nil then
        return
    end
    if self.scaleItems == nil or self.slowRound % FPL.SCALE_EVERY == 0 then
        local scale = newDoc()
        if self:safe("harvestScale", self.addHarvestScale, self, scale) then
            self.scaleItems = scale.items
        end
    end
    self.slowRound = self.slowRound + 1

    local doc = newDoc()
    self:safe("prices", self.addPrices, self, doc)
    append(doc, self.scaleItems or {})
    self:safe("productions", self.addProductions, self, doc)

    local sig = signature(doc)
    if sig == self.dataSig then
        return
    end
    self.dataRev = self.dataRev + 1
    put(doc, "s", ROOT .. "#session", self.session)
    put(doc, "i", ROOT .. "#rev", self.dataRev)
    if writeDoc(dir .. "data.xml", doc) then
        self.dataSig = sig
        self.heartbeatTimer = FPL.HEARTBEAT_MS
    end
end

-- What the game charges per litre when you buy a fill type, with the economic
-- difficulty applied. Only the fill types the app prices (keep this list the
-- same as LIVE_LINK_INPUT_FILLTYPES in live-link.js): asking about every fill
-- type stopped at the first one the game has no price for, and then nothing
-- was reported at all.
local PRICE_FILLTYPES = {
    "SEEDS", "FERTILIZER", "LIQUIDFERTILIZER", "LIME", "HERBICIDE", "MANURE", "LIQUIDMANURE",
    "DIGESTATE", "DIESEL", "DEF", "SILAGE_ADDITIVE", "MINERAL_FEED", "ROADSALT"
}

local function getBuyPrice(economy, fillTypeIndex)
    local function ask(method, ...)
        if economy[method] == nil then
            return nil
        end
        local ok, price = pcall(economy[method], economy, ...)
        if ok and type(price) == "number" and price > 0 then
            return price
        end
        return nil
    end
    return ask("getCostPerLiter", fillTypeIndex, true) or ask("getPricePerLiter", fillTypeIndex)
end

function FPL:addPrices(doc)
    local economy = g_currentMission.economyManager
    if economy == nil then
        return
    end
    local i = 0
    for _, name in ipairs(PRICE_FILLTYPES) do
        local index = g_fillTypeManager:getFillTypeIndexByName(name)
        local price = index ~= nil and getBuyPrice(economy, index) or nil
        if price ~= nil then
            local k = string.format("%s.prices.fillType(%d)", ROOT, i)
            put(doc, "s", k .. "#name", name)
            put(doc, "f", k .. "#pricePerLiter", price)
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

function FPL:addHarvestScale(doc)
    local mission = g_currentMission
    if mission.getHarvestScaleMultiplier == nil then
        return false
    end
    for i, fruitType in ipairs(g_fruitTypeManager:getFruitTypes()) do
        local k = string.format("%s.harvestScale.fruit(%d)", ROOT, i - 1)
        put(doc, "s", k .. "#name", fruitType.name)
        for _, probe in ipairs(HARVEST_PROBES) do
            put(doc, "f", k .. "#" .. probe[1], mission:getHarvestScaleMultiplier(fruitType.index, probe[2], probe[3], probe[4], probe[5], probe[6], probe[7], 0))
        end
    end
    return true
end

-- Recipes of the farm's production points, including the base game ones the
-- app cannot read (they live in the game's packed data).
function FPL:addProductions(doc)
    local manager = g_currentMission.productionChainManager
    if manager == nil or manager.getProductionPointsForFarmId == nil then
        return
    end
    local fillName = function(index)
        return tostring(g_fillTypeManager:getFillTypeNameByIndex(index) or "")
    end
    for i, point in ipairs(manager:getProductionPointsForFarmId(self:getFarmId())) do
        local placeable = point.owningPlaceable
        local k = string.format("%s.productions.production(%d)", ROOT, i - 1)
        if placeable ~= nil then
            put(doc, "s", k .. "#filename", tostring(placeable.configFileName or ""))
            if placeable.getName ~= nil then
                put(doc, "s", k .. "#name", tostring(placeable:getName() or ""))
            end
        end
        for j, production in ipairs(point.productions or {}) do
            local rk = string.format("%s.recipe(%d)", k, j - 1)
            put(doc, "s", rk .. "#id", tostring(production.id or ""))
            put(doc, "f", rk .. "#cyclesPerMonth", production.cyclesPerMonth or 0)
            for n, input in ipairs(production.inputs or {}) do
                local ik = string.format("%s.input(%d)", rk, n - 1)
                put(doc, "s", ik .. "#fillType", fillName(input.type))
                put(doc, "f", ik .. "#amount", input.amount or 0)
            end
            for n, output in ipairs(production.outputs or {}) do
                local ok = string.format("%s.output(%d)", rk, n - 1)
                put(doc, "s", ok .. "#fillType", fillName(output.type))
                put(doc, "f", ok .. "#amount", output.amount or 0)
            end
        end
    end
end

addModEventListener(FarmerPlannerLink)
