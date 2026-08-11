$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:8091'

# Seed entities (idempotent upserts)
Invoke-RestMethod -Method Post -Uri "$base/api/channels" -ContentType 'application/json' -Body '{"id":"ch1","name":"Smoke Channel","driver":"modbus-tcp"}' | Out-Null
Invoke-RestMethod -Method Post -Uri "$base/api/devices" -ContentType 'application/json' -Body '{"id":"d1","channelId":"ch1","name":"Smoke PLC","settings":{"host":"127.0.0.1"}}' | Out-Null
Invoke-RestMethod -Method Post -Uri "$base/api/tags" -ContentType 'application/json' -Body '{"id":"d1.t1","deviceId":"d1","name":"Smoke Tag","address":"40001","dataType":"uint16"}' | Out-Null

# 1. Project export
$proj = Invoke-WebRequest -UseBasicParsing -Uri "$base/api/project/export"
Write-Output "EXPORT project: $($proj.StatusCode) $($proj.Headers['Content-Disposition'])"

# 2. Device export
$dev = Invoke-WebRequest -UseBasicParsing -Uri "$base/api/devices/d1/export"
Write-Output "EXPORT device: $($dev.StatusCode) $($dev.Headers['Content-Disposition'])"

# 3. Tag CSV export
$csv = Invoke-WebRequest -UseBasicParsing -Uri "$base/api/tags/export?device=d1"
Write-Output "EXPORT tags csv: $($csv.StatusCode) $($csv.Headers['Content-Disposition'])"
Write-Output "--- CSV body ---"
Write-Output $csv.Content
Write-Output "----------------"

# 4. Tag CSV import
$csvBody = "name,address,dataType`r`nImported Tag,40002,int16"
$imp = Invoke-RestMethod -Method Post -Uri "$base/api/tags/import?device=d1" -ContentType 'text/csv' -Body $csvBody
Write-Output "IMPORT tags csv: tags=$($imp.imported.tags)"

# 5. Project import (replace with the exported project)
$impProj = Invoke-RestMethod -Method Post -Uri "$base/api/project/import?mode=replace" -ContentType 'application/json' -Body $proj.Content
Write-Output "IMPORT project replace: channels=$($impProj.imported.channels) devices=$($impProj.imported.devices) tags=$($impProj.imported.tags)"

# 6. Device bundle import
$devBundle = Invoke-RestMethod -Method Post -Uri "$base/api/devices/import?channel=ch1" -ContentType 'application/json' -Body $dev.Content
Write-Output "IMPORT device bundle: device=$($devBundle.device.id) tags=$($devBundle.imported.tags)"

Write-Output "SMOKE TEST COMPLETE"
