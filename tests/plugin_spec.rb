# frozen_string_literal: true

require 'json'
require 'yaml'

RSpec.describe 'Viessmann heat pump' do
  let(:now) { '2026-10-18T18:10:00Z' }
  let(:device) { 'v2' }
  let(:data) do
    YAML.load_file(File.join(__dir__, '..', '.trmnlp.yml')).fetch('variables')
        .reject { |key, _| key == 'trmnl' }.merge('demo' => false)
  end

  def feature(name)
    data.fetch('data').find { |item| item['feature'] == name }
  end

  def transform(custom_fields = {}, payload: data, at: now, **fields)
    run = trmnl.transform(data: payload, custom_fields: custom_fields.merge(fields), now: at, device:)
    expect(run.error).to be_nil
    run.data
  end

  def render(view = 'full', language = 'en', custom_fields: {}, payload: data)
    trmnl.render(view:, data: payload, now:, device:, custom_fields: custom_fields.merge(language:))
  end

  def document(screen)
    Nokogiri::HTML(screen.result.html)
  end

  %w[en de].each do |language|
    %w[full half_horizontal half_vertical quadrant].each do |view|
      it "renders #{view} in #{language} through the official Liquid runtime" do
        data['data'] << reading('heating.power.consumption.summary.heating', 'currentDay', 8)
        data['data'] << reading('heating.power.consumption.summary.dhw', 'currentDay', 4.34)
        data['data'] << reading('heating.heat.production.summary.heating', 'currentDay', 35)
        data['data'] << reading('heating.heat.production.summary.dhw', 'currentDay', 13.6)
        data['data'] << { 'feature' => 'heating.circuits.0.sensors.temperature.supply', 'properties' => { 'value' => { 'value' => 30.2 } } }
        data['data'] << { 'feature' => 'heating.circuits.0.temperature', 'properties' => { 'value' => { 'value' => 32.4 } } }
        data['data'] << reading('heating.compressors.0', 'active', true)
        data['data'] << reading('heating.heatingRod.status', 'overall', false)
        data['data'] << reading('heating.primaryCircuit.fans.0.current', 'value', 45, 'percent')
        screen = render(view, language)
        expect(screen).to have_no_transform_error.and(have_no_leaked_text)
        html = document(screen)
        expect(html.at_css('.vp')['lang']).to eq(language)
        expect(html.at_css('.vp').to_html).not_to match(/\bAPI\b|calculated|berechnet|berechnung/i)
        expect(html.at_css('.vp-activity').text).to eq(language == 'de' ? 'Heizung' : 'Heating')
        expect(html.at_css('.vp').text).not_to match(/\b(?:CEST|CET|MESZ|MEZ|UTC|GMT)\b/)
        expect(html.at_css('.vp-curve-readings').text).to include(language == 'de' ? '32,4' : '32.4')
        expect(html.css('.vp-blocks > section').size).to eq(4)
        expect(html.at_css('.vp-water-block .vp-water').text).to include(language == 'de' ? '48,2' : '48.2')
        expect(html.at_css('.vp-heating-block > .vp-metrics .vp-pressure').text).to include(language == 'de' ? '1,8' : '1.8')
        expect(html.at_css('.vp-supply-readings > .vp-supply-target .vp-full-label').text).to eq(language == 'de' ? 'Soll' : 'Target')
        expect(html.at_css('.vp-heating-block svg')).not_to be_nil
        expect(html.at_css('.vp-energy-block .vp-energy')).not_to be_nil
        expect(html.at_css('.vp-energy-block .vp-block-title').text).to eq(language == 'de' ? 'Verbrauch heute' : 'Usage today')
        expect(html.css('.vp-supply-marker, .vp-return-marker, .vp-measured-guide')).to be_empty
        expect(html.at_css('.vp-target-marker')).not_to be_nil
        expect(html.css('.vp-curve-step').size).to eq(6)
        expect(html.css('.vp-x-tick').size).to eq(6)
        expect(html.css('.vp-mode, .vp-points, .vp-energy-asof')).to be_empty
        expect(html.css('path[stroke-dasharray="7 4"]')).to be_empty
        expect(html.css('.vp-chart .vp-params > div').size).to eq(2)
        expect(html.at_css('.vp-heating-block > .vp-metrics .vp-room-target').text).to include('22')
        expect(html.css('.vp-block-active').map { |block| block['class'] }).to eq(['vp-block vp-heating-block vp-block-active'])
        expect(html.at_css('.vp-water-block .vp-use-energy').text).to include(language == 'de' ? '4,34' : '4.34')
        expect(html.at_css('.vp-heating-block .vp-use-energy').text).to include('8 kWh', '35 kWh')
        expect(html.css('.vp-water-flows')).to be_empty
        expect(html.css('.vp-glyph').map { |glyph| glyph['data-glyph'] }).to contain_exactly('heating', 'water', 'pressure', 'compressor', 'auxiliary', 'fan')
        expect(html.at_css('.vp-footer').text).to include('18.10.2026, 20:00')
        expect(html.at_css('.vp-footer').text).not_to match(/TRMNL|Read only|Nur Anzeige/)
        expect(html.at_css('.vp-blocks').text).not_to match(/18[.]10[.]2026/)
        expect(html.css('.vp-mode')).to be_empty
        expect(html.at_css('.vp-energy').text).to include('12.34'.tr('.', language == 'de' ? ',' : '.'), '48.6'.tr('.', language == 'de' ? ',' : '.'))
        expect(html.at_css('.vp-power').text).to include('1.8'.tr('.', language == 'de' ? ',' : '.'), '7.2'.tr('.', language == 'de' ? ',' : '.'))
        expect(html.at_css('.vp-energy').text).not_to match(/\bkW\b/)
        expect(html.at_css('.vp')['class'].include?('vp-compact')).to eq(view != 'full')
        expect(html.at_css('.vp')['class'].include?('vp-small')).to eq(%w[half_vertical quadrant].include?(view))
      end
    end
  end

  it 'renders missing readings without inventing temperatures or a curve' do
    html = document(render(payload: {}))
    expect(html.at_css('.vp-badge').text).to include('Not connected')
    expect(html.css('polyline')).to be_empty
    expect(html.at_css('.vp-metrics').text).to include('—')
  end

  it 'reads actual compressor and auxiliary activity, including false, without using availability or approval settings' do
    data['data'] << reading('heating.compressors.0', 'active', true)
    data['data'] << reading('heating.heatingRod.status', 'overall', false)
    data['data'] << reading('heating.heatingRod', 'active', true)
    data['data'] << reading('heating.configuration.heatingRod.heating', 'useApproved', true)
    expect(transform.fetch('components')).to include('compressor' => 'on', 'auxiliary' => 'off', 'fan' => 'unknown')
    html = document(render('full', 'de'))
    expect(html.at_css('[data-component="compressor"] .vp-component-state').text).to eq('Ein')
    expect(html.at_css('[data-component="auxiliary"] .vp-component-state').text).to eq('Aus')
    expect(html.at_css('[data-component="fan"] .vp-component-state').text).to eq('—')
  end

  it 'never treats heater availability as running and reads the actual overall state' do
    data['data'] << reading('heating.heatingRod', 'active', true)
    expect(transform.dig('components', 'auxiliary')).to eq('unknown')
    status = reading('heating.heatingRod.status', 'overall', false)
    data['data'] << status
    expect(transform.dig('components', 'auxiliary')).to eq('off')
    status['properties']['overall']['value'] = true
    expect(transform.dig('components', 'auxiliary')).to eq('on')
    status['isEnabled'] = false
    expect(transform.dig('components', 'auxiliary')).to eq('unknown')
  end

  it 'uses actual heater stages when overall status is absent, preserving unknown stages' do
    status = reading('heating.heatingRod.status', 'level1', false)
    status['properties']['level2'] = { 'value' => false }
    status['properties']['level3'] = { 'value' => false }
    data['data'] << status
    expect(transform.dig('components', 'auxiliary')).to eq('off')
    status['properties']['level2']['value'] = true
    expect(transform.dig('components', 'auxiliary')).to eq('on')
    status['properties']['level2']['value'] = false
    status['properties'].delete('level3')
    expect(transform.dig('components', 'auxiliary')).to eq('unknown')
  end

  it 'uses measured heater electrical draw only when stage status is unavailable' do
    data['data'] << reading('heating.heatingRod', 'active', true)
    power = reading('heating.heatingRod.power.consumption.current', 'value', 0, 'W')
    data['data'] << power
    expect(transform.dig('components', 'auxiliary')).to eq('off')
    power['properties']['value']['value'] = 3
    power['properties']['value']['unit'] = 'kW'
    expect(transform.dig('components', 'auxiliary')).to eq('on')
    data['data'] << reading('heating.heatingRod.status', 'overall', false)
    expect(transform.dig('components', 'auxiliary')).to eq('off')
    data['data'].reject! { |item| item['feature'] == 'heating.heatingRod.status' }
    power['properties']['value']['unit'] = 'kWh'
    expect(transform.dig('components', 'auxiliary')).to eq('unknown')
    power['properties']['value']['unit'] = 'W'
    power['isEnabled'] = false
    expect(transform.dig('components', 'auxiliary')).to eq('unknown')
  end

  it 'aggregates fan speed and avoids treating unavailable or disabled fans as off' do
    fan0 = reading('heating.primaryCircuit.fans.0.current', 'value', 0)
    fan1 = reading('heating.primaryCircuit.fans.1.current', 'value', 35)
    data['data'].concat([fan0, fan1])
    expect(transform.dig('components', 'fan')).to eq('on')
    fan1['properties']['value']['value'] = 0
    expect(transform.dig('components', 'fan')).to eq('off')
    fan1['isEnabled'] = false
    expect(transform.dig('components', 'fan')).to eq('unknown')
    fan1['isEnabled'] = true
    fan1['properties']['status'] = { 'value' => 'disconnected' }
    expect(transform.dig('components', 'fan')).to eq('unknown')
    fan0['properties']['value']['value'] = 10
    expect(transform.dig('components', 'fan')).to eq('on')
  end

  it 'does not interpret missing, disabled or malformed component activation as off' do
    compressor = reading('heating.compressors.0', 'active', 'false')
    data['data'] << compressor
    expect(transform.dig('components', 'compressor')).to eq('unknown')
    compressor['properties']['active']['value'] = true
    compressor['isEnabled'] = false
    expect(transform.dig('components', 'compressor')).to eq('unknown')
    expect(transform.dig('components', 'auxiliary')).to eq('unknown')
  end

  it 'does not infer activity from the selected operating mode or an isolated pump status' do
    data['data'].reject! { |item| %w[heating.secondaryCircuit.operation.state heating.dhw.charging].include?(item['feature']) }
    expect(transform.dig('activity', 'state')).to eq('unknown')
    expect(document(render).at_css('.vp-activity').text).to eq('Status unknown')
  end

  it 'shows off when the current operating state is standby even with circulation on' do
    feature('heating.secondaryCircuit.operation.state')['properties']['currentValue']['value'] = 'standby'
    expect(transform.dig('activity', 'state')).to eq('off')
    expect(document(render).at_css('.vp-activity').text).to eq('Off')
  end

  it 'gives active hot-water charging priority over heating circulation' do
    feature('heating.dhw.charging')['properties']['active']['value'] = true
    expect(transform.dig('activity', 'state')).to eq('dhw')
    expect(document(render('full', 'de')).at_css('.vp-activity').text).to eq('Warmwasser')
  end

  %w[dhw domesticHotWater heating standby off cooling defrost].each do |state|
    it "uses current state #{state} and ignores the future target state" do
      operation = feature('heating.secondaryCircuit.operation.state')['properties']
      operation['currentValue']['value'] = state
      operation['targetValue'] = { 'value' => 'domesticHotWater' }
      expected = { 'dhw' => 'dhw', 'domesticHotWater' => 'dhw', 'heating' => 'heating', 'standby' => 'off', 'off' => 'off' }.fetch(state, 'unknown')
      expect(transform.dig('activity', 'state')).to eq(expected)
    end
  end

  it 'uses valve routing only while operation is active' do
    data['data'] << { 'feature' => 'heating.valves.fourThreeWay.position', 'properties' => { 'value' => { 'value' => 'domesticHotWater' } } }
    expect(transform.dig('activity', 'state')).to eq('dhw')
    feature('heating.secondaryCircuit.operation.state')['properties']['currentValue']['value'] = 'standby'
    expect(transform.dig('activity', 'state')).to eq('off')
    feature('heating.secondaryCircuit.operation.state')['isEnabled'] = false
    feature('heating.circuits.0.circulation.pump')['isEnabled'] = false
    expect(transform.dig('activity', 'state')).to eq('unknown')
  end

  it 'can use charging plus pump signals when current operation is unsupported' do
    data['data'].reject! { |item| item['feature'] == 'heating.secondaryCircuit.operation.state' }
    expect(transform.dig('activity', 'state')).to eq('heating')
    feature('heating.circuits.0.circulation.pump')['properties']['status']['value'] = 'off'
    expect(transform.dig('activity', 'state')).to eq('off')
    feature('heating.dhw.charging')['isEnabled'] = false
    expect(transform.dig('activity', 'state')).to eq('unknown')
  end

  it 'does not interpret disabled, error, or string-valued charging as active' do
    feature('heating.dhw.charging')['properties']['active']['value'] = 'true'
    expect(transform.dig('activity', 'state')).to eq('heating')
    feature('heating.dhw.charging')['properties']['active']['value'] = true
    feature('heating.dhw.charging')['isEnabled'] = false
    expect(transform.dig('activity', 'state')).to eq('heating')
    feature('heating.dhw.charging')['isEnabled'] = true
    feature('heating.dhw.charging')['properties']['status'] = { 'value' => 'error' }
    expect(transform.dig('activity', 'state')).to eq('heating')
  end

  it 'uses the water-pressure sensor, independently of compressor refrigerant pressure' do
    data['data'] << { 'feature' => 'heating.compressors.0.sensors.pressure.inlet', 'properties' => { 'value' => { 'value' => 20, 'unit' => 'bar' } } }
    expect(transform.dig('pressure', 'bar')).to eq(1.8)
    expect(document(render('full', 'de')).at_css('.vp-pressure').text).to include('Druck', '1,8bar')
  end

  [['bar', 0, 0], ['kPa', 180, 1.8], ['pascal', 180_000, 1.8], ['millibar', 1800, 1.8], ['celsius', 30, nil], [nil, 1.8, nil], ['bar', -1, nil]].each do |unit, value, expected|
    it "handles pressure #{value} #{unit.inspect} without inventing units" do
      feature('heating.sensors.pressure.supply')['properties']['value'] = { 'value' => value, 'unit' => unit }
      expect(transform.dig('pressure', 'bar')).to eq(expected)
    end
  end

  it 'retains pressure freshness separately and rejects unavailable sensors' do
    sensor = feature('heating.sensors.pressure.supply')
    sensor['timestamp'] = '2026-10-18T10:00:00Z'
    expect(transform.dig('pressure', 'stale')).to be(true)
    expect(transform.dig('freshness', 'stale')).to be(false)
    sensor['properties']['status']['value'] = 'disconnected'
    expect(transform.dig('pressure', 'bar')).to be_nil
    expect(document(render).at_css('.vp-pressure').text).to include('—bar')
  end

  it 'prefers circuit supply and the live circuit target over heat-pump supply and the model' do
    feature('heating.secondaryCircuit.sensors.temperature.supply')['properties']['value']['value'] = 45
    data['data'] << { 'feature' => 'heating.circuits.0.sensors.temperature.supply', 'properties' => { 'value' => { 'value' => 28 } } }
    data['data'] << { 'feature' => 'heating.circuits.0.temperature', 'properties' => { 'value' => { 'value' => 27 } } }
    result = transform(supply_feature: 'heating.secondaryCircuit.sensors.temperature.supply')
    expect(result.dig('supply_reading', 'feature')).to eq('heating.circuits.0.sensors.temperature.supply')
    expect(result['supply_scope']).to eq('circuit')
    expect(result.dig('setpoints', 'supply')).to eq(27)
    expect(result.dig('setpoints', 'supply_calculated')).to be_nil
    html = document(render)
    expect(result.dig('supply_reading', 'value')).to eq(28)
    expect(html.at_css('.vp-supply-target').text).to include('27 °C')
    expect(html.at_css('.vp-curve-readings').text).not_to include('45 °C')
  end

  it 'labels the heat-pump fallback and skips unusable circuit sensors' do
    data['data'] << { 'feature' => 'heating.circuits.0.sensors.temperature.supply', 'isEnabled' => false, 'properties' => { 'value' => { 'value' => 28 } } }
    expect(transform['supply_scope']).to eq('heat_pump')
    expect(document(render).at_css('.vp').text).not_to include('Heat pump supply', 'Heat pump return')
    sensor = feature('heating.circuits.0.sensors.temperature.supply')
    sensor['isEnabled'] = true
    sensor['properties']['status'] = { 'value' => 'disconnected' }
    expect(transform['supply_scope']).to eq('heat_pump')
  end

  it 'keeps outlying measurements in diagnostics without changing the target-only plot' do
    feature('heating.secondaryCircuit.sensors.temperature.supply')['properties']['value']['value'] = 75
    result = transform
    expect(result.dig('curve', 'ticks').last['value']).to eq(55)
    expect(result.dig('supply_reading', 'value')).to eq(75)
    expect(document(render).at_css('.vp').text).not_to include('75 °C')
    expect(result.dig('curve', 'points').map { |point| point['supply'] }.max).to eq(50)
  end

  it 'omits markers for missing or invalid sensors without inventing readings' do
    feature('heating.secondaryCircuit.sensors.temperature.supply')['isEnabled'] = false
    expect(transform.dig('curve', 'measured')).to be_nil
    feature('heating.sensors.temperature.outside')['isEnabled'] = false
    expect(transform.dig('curve', 'target')).to be_nil
    expect(document(render).css('.vp-supply-marker, .vp-target-marker')).to be_empty
  end

  it 'shows the latest displayed reading while preserving the oldest sensor freshness' do
    feature('heating.sensors.temperature.outside')['timestamp'] = '2026-10-18T10:00:00Z'
    feature('heating.compressors.0.power.consumption.current')['timestamp'] = '2026-10-18T18:05:00Z'
    feature('heating.circuits.0.heating.curve')['timestamp'] = '2026-10-18T18:09:00Z'
    result = transform
    expect(result.dig('freshness', 'latest_reading')).to eq('18.10.2026, 20:05')
    expect(result.dig('freshness', 'oldest_sensor')).to eq('18.10.2026, 12:00')
    expect(result.dig('freshness', 'stale')).to be(true)
    html = document(render)
    expect(html.at_css('.vp-footer').text.strip).to eq('Updated: 18.10.2026, 20:05')
    expect(html.at_css('.vp-blocks').text).not_to include('20:05', '12:00')
    expect(html.at_css('.vp').text).not_to match(/Stale data|Daten veraltet/)
  end

  it 'includes return and pressure timestamps only for usable displayed readings' do
    feature('heating.sensors.temperature.return')['timestamp'] = '2026-10-18T18:03:00Z'
    feature('heating.sensors.pressure.supply')['timestamp'] = '2026-10-18T18:06:00Z'
    expect(transform.dig('freshness', 'latest_reading')).to include('20:06')
    feature('heating.sensors.pressure.supply')['isEnabled'] = false
    expect(transform.dig('freshness', 'latest_reading')).to include('20:03')
  end

  it 'uses only the matching circuit return and rejects disconnected readings' do
    data['data'] << { 'feature' => 'heating.circuits.0.sensors.temperature.supply', 'properties' => { 'value' => { 'value' => 28 } } }
    data['data'] << { 'feature' => 'heating.circuits.0.sensors.temperature.return', 'properties' => { 'value' => { 'value' => 24.5 } } }
    expect(transform.fetch('return_reading')).to include('value' => 24.5, 'scope' => 'circuit')
    feature('heating.circuits.0.sensors.temperature.return')['isEnabled'] = false
    feature('heating.sensors.temperature.return')['properties']['status']['value'] = 'disconnected'
    expect(transform.dig('return_reading', 'value')).to be_nil
    expect(document(render).css('.vp-return-marker')).to be_empty
  end

  it 'does not pair a hot heat-pump return with the selected circuit supply' do
    data['data'] << { 'feature' => 'heating.circuits.0.sensors.temperature.supply', 'properties' => { 'value' => { 'value' => 26 } } }
    feature('heating.sensors.temperature.return')['properties']['value']['value'] = 44.2
    expect(transform.fetch('return_reading')).to include('value' => nil, 'scope' => 'circuit')
    expect(document(render).at_css('.vp-curve-readings').text).not_to include('44.2')
  end

  %w[heating dhw standby cooling].each do |state|
    it "shows flow/return only for the active use in state #{state}" do
      feature('heating.secondaryCircuit.operation.state')['properties']['currentValue']['value'] = state
      data['data'] << { 'feature' => 'heating.dhw.sensors.temperature.tankLoadSystem.supply', 'properties' => { 'value' => { 'value' => 47 } } }
      data['data'] << { 'feature' => 'heating.dhw.sensors.temperature.tankLoadSystem.return', 'properties' => { 'value' => { 'value' => 42 } } }
      values = transform.fetch('temperatures')
      expect(values.fetch('heating')).to include('supply' => state == 'heating' ? 32.4 : nil, 'return' => state == 'heating' ? 27.1 : nil)
      expect(values.fetch('dhw')).to include('supply' => state == 'dhw' ? 47 : nil, 'return' => state == 'dhw' ? 42 : nil)
      html = document(render)
      expect(html.css('.vp-water-flows')).to be_empty
      expect(html.at_css('.vp').text).not_to include('Heat pump return', '47 °C', '42 °C')
      expect(html.at_css('.vp-supply-target .vp-value').text).to include('—') # no circuit target in this payload
    end
  end

  it 'requires active selected-circuit circulation and never substitutes cylinder temperature for flow' do
    feature('heating.circuits.0.circulation.pump')['properties']['status']['value'] = 'off'
    expect(transform.dig('temperatures', 'heating', 'supply')).to be_nil
    expect(document(render).css('.vp-heating-block.vp-block-active')).to be_empty
    feature('heating.secondaryCircuit.operation.state')['properties']['currentValue']['value'] = 'dhw'
    expect(transform.fetch('temperatures').fetch('dhw')).to include('supply' => nil, 'return' => nil)
    expect(document(render).css('.vp-water-flows')).to be_empty
  end

  it 'displays only radiator-circuit actual and target, including when idle' do
    feature('heating.secondaryCircuit.sensors.temperature.supply')['properties']['value']['value'] = 45
    data['data'] << { 'feature' => 'heating.circuits.0.sensors.temperature.supply', 'properties' => { 'value' => { 'value' => 26 } } }
    data['data'] << { 'feature' => 'heating.circuits.0.temperature', 'properties' => { 'value' => { 'value' => 26.5 } } }
    feature('heating.secondaryCircuit.operation.state')['properties']['currentValue']['value'] = 'standby'
    result = transform(supply_feature: 'heating.secondaryCircuit.sensors.temperature.supply')
    expect(result.fetch('radiator')).to include('supply' => 26, 'target' => 26.5)
    html = document(render)
    expect(html.at_css('.vp-supply-actual').text).to include('26°C')
    expect(html.at_css('.vp-supply-target').text).to include('26.5 °C')
    expect(html.at_css('.vp-supply-readings').text).not_to include('45')
  end

  it 'does not use heat-pump/custom sensors or the curve estimate as radiator readings' do
    data['data'] << { 'feature' => 'custom.target', 'properties' => { 'value' => { 'value' => 45 } } }
    expect(transform(supply_setpoint_feature: 'custom.target').fetch('radiator')).to include('supply' => nil, 'target' => nil)
    expect(document(render).at_css('.vp-supply-readings').text.scan('—').size).to eq(2)
    expect(transform.dig('curve', 'target')).to be_nil
  end

  it 'selects actual and target from the configured radiator circuit and rejects disconnected readings' do
    data['data'] << { 'feature' => 'heating.circuits.1.sensors.temperature.supply', 'properties' => { 'value' => { 'value' => 31 } } }
    data['data'] << { 'feature' => 'heating.circuits.1.temperature', 'properties' => { 'value' => { 'value' => 30 } } }
    expect(transform(circuit: '1').fetch('radiator')).to include('circuit' => '1', 'supply' => 31, 'target' => 30)
    feature('heating.circuits.1.sensors.temperature.supply')['properties']['status'] = { 'value' => 'disconnected' }
    expect(transform(circuit: '1').dig('radiator', 'supply')).to be_nil
  end

  it 'reads daily heating and water separately alongside whole-device totals' do
    data['data'] << reading('heating.power.consumption.summary.heating', 'currentDay', 8000, 'Wh')
    data['data'] << reading('heating.power.consumption.summary.dhw', 'currentDay', 0)
    result = transform
    expect(result.dig('energy', 'today_kwh')).to eq(12.34)
    expect(result.dig('energy', 'by_use', 'heating', 'today_kwh')).to eq(8)
    expect(result.dig('energy', 'by_use', 'dhw', 'today_kwh')).to eq(0)
    expect(result.dig('heat', 'by_use')).to eq({})
    expect(document(render).at_css('.vp-water-block .vp-use-energy').text).to include('0 kWh', '— kWh')
  end

  it 'does not substitute yesterday use counters or a whole-device total for individual uses' do
    data['data'] << reading('heating.power.consumption.summary.heating', 'currentDay', 8, timestamp: '2026-10-17T18:00:00Z')
    expect(transform.dig('energy', 'by_use')).to eq({})
    expect(document(render).at_css('.vp-heating-block .vp-use-energy').text).to include('— kWh')
  end

  it 'moves the thick border to hot water and removes it when off' do
    feature('heating.dhw.charging')['properties']['active']['value'] = true
    expect(document(render).css('.vp-block-active').map { |block| block['class'] }).to eq(['vp-block vp-water-block vp-block-active'])
    feature('heating.dhw.charging')['properties']['active']['value'] = false
    feature('heating.secondaryCircuit.operation.state')['properties']['currentValue']['value'] = 'standby'
    expect(document(render).css('.vp-block-active')).to be_empty
  end

  it 'defaults to English for an unsupported language' do
    expect(document(render('full', 'fr')).at_css('.vp')['lang']).to eq('en')
  end

  it 'keeps six labelled reference points on the nonlinear, capped E3 curve' do
    curve = transform.fetch('curve')
    labelled = curve.fetch('points').select { |point| point['label'] }
    expect(labelled.map { |point| point['outdoor'] }).to eq([-30, -20, -10, 0, 10, 20])
    expect(labelled.map { |point| point['supply'] }).to eq([50, 44.8, 40.3, 36, 31.3, 25.4])
    expect(curve.fetch('points').size).to eq(51)
    expect(curve.fetch('max_supply')).to eq(50)
    expect(curve.fetch('max_from_api')).to be(true)
  end

  it 'updates the complete curve when API slope, room target and limits change' do
    feature('heating.circuits.0.heating.curve')['properties']['slope']['value'] = 1.2
    feature('heating.circuits.0.temperature.levels')['properties']['max']['value'] = 40
    capped = transform.fetch('curve').fetch('points')
    expect(capped.count { |point| point['supply'] == 40 }).to be > 5
    expect(capped).to all(include('supply' => be <= 40))
    feature('heating.circuits.0.operating.programs.normal')['properties']['temperature']['value'] = 24
    expect(transform.fetch('curve').fetch('points')).not_to eq(capped)
  end

  it 'gives API limits precedence over the configured fallback' do
    feature('heating.circuits.0.temperature.levels')['properties']['min']['value'] = 30
    result = transform(max_supply_temperature: '35')
    expect(result.dig('curve', 'max_supply')).to eq(50)
    expect(result.dig('curve', 'points').last['supply']).to eq(30)
    data['data'].reject! { |item| item['feature'].end_with?('.temperature.levels') }
    result = transform(max_supply_temperature: '35')
    expect(result.dig('curve', 'max_supply')).to eq(35)
    expect(result.dig('curve', 'max_from_api')).to be(false)
  end

  it 'does not assume a missing room setpoint or supply limit' do
    data['data'].reject! { |item| item['feature'].end_with?('.temperature.levels') }
    expect(transform.dig('curve', 'max_supply')).to be_nil
    data['data'].reject! { |item| item['feature'].end_with?('.operating.programs.normal') }
    expect(transform['curve']).to be_nil
  end

  it 'keeps explicit supply, water and room targets separate' do
    data['data'] << { 'feature' => 'custom.supply.target', 'properties' => { 'value' => { 'value' => 33 } } }
    result = transform(supply_setpoint_feature: 'custom.supply.target')
    expect(result.fetch('setpoints')).to include('supply' => 33, 'water' => 50, 'room' => 22)
    expect(result.dig('setpoints', 'supply_calculated')).to be_nil
  end

  it 'retains model-derived target metadata without a source annotation on the display' do
    expect(transform.dig('setpoints', 'supply_calculated')).to be(true)
    expect(document(render).at_css('.vp-target').text.strip).to start_with('Target:')
  end

  it 'accepts reference points without labelling them as live API curve points' do
    points = [-30, -20, -10, 0, 10, 20].zip([45, 45, 40, 35, 30, 22]).map { |outdoor, supply| { outdoor:, supply: } }
    curve = transform(curve_points: JSON.generate(points)).fetch('curve')
    expect(curve.fetch('reference')).to be(true)
    expect(curve.fetch('points').size).to eq(6)
    expect(curve.fetch('points').first['supply']).to eq(45)
  end

  it 'ignores old configuration timestamps when checking sensor freshness' do
    data['data'].each { |item| item['timestamp'] = '2000-01-01T00:00:00Z' unless item['feature'].include?('.sensors.temperature.') }
    expect(transform.fetch('freshness')).to include('stale' => false, 'missing_time' => false)
  end

  it 'uses the oldest temperature reading and the configured staleness threshold' do
    expect(transform(stale_minutes: '5').dig('freshness', 'stale')).to be(true)
    expect(transform(stale_minutes: '120').dig('freshness', 'stale')).to be(false)
    feature('heating.sensors.temperature.outside')['timestamp'] = '2026-10-18T10:00:00Z'
    expect(transform.dig('freshness', 'stale')).to be(true)
  end

  it 'marks missing sensor timestamps as unknown' do
    feature('heating.sensors.temperature.outside').delete('timestamp')
    expect(transform.dig('freshness', 'missing_time')).to be(true)
  end

  [['2026-01-15T12:00:00Z', '13:00'], ['2026-07-15T12:00:00Z', '14:00'],
   ['2026-03-29T00:30:00Z', '01:30'], ['2026-03-29T01:30:00Z', '03:30']].each do |utc, local|
    it "formats Europe/Berlin correctly at #{utc}" do
      data['data'].each { |item| item['timestamp'] = utc }
      expect(transform(time_zone: 'Europe/Berlin').dig('freshness', 'oldest_sensor')).to include(local)
    end
  end

  it 'falls back to UTC for invalid zones without changing freshness' do
    expect(transform(time_zone: 'America/New_York').dig('freshness', 'oldest_sensor')).to include('14:00')
    result = transform(time_zone: 'invalid/timezone').fetch('freshness')
    expect(result).to include('time_zone' => 'UTC', 'stale' => false)
    expect(result.fetch('oldest_sensor')).to include('18:00')
  end

  it 'keeps zero, negative and disabled sensor readings distinct' do
    feature('heating.secondaryCircuit.sensors.temperature.supply')['properties']['value']['value'] = 0
    feature('heating.sensors.temperature.outside')['properties']['value']['value'] = '-5.2'
    feature('heating.dhw.sensors.temperature.dhwCylinder')['isEnabled'] = false
    html = document(render)
    expect(html.at_css('.vp-metrics').text).to include('-5.2°C')
    expect(html.at_css('.vp-water').text).to include('—°C')
    expect(transform.dig('supply_reading', 'value')).to eq(0)
  end

  it 'supports custom sensors, another circuit and multi-URL response wrappers' do
    data['data'].each { |item| item['feature'].sub!('heating.circuits.0.', 'heating.circuits.1.') }
    feature('heating.secondaryCircuit.sensors.temperature.supply')['feature'] = 'custom.supply'
    result = transform({ circuit: '1', supply_feature: 'custom.supply' }, payload: { 'IDX_0' => data })
    expect(result.fetch('data').map { |item| item['feature'] }).to include('custom.supply', 'heating.circuits.1.heating.curve')
    expect(result.dig('curve', 'max_supply')).to eq(50)
  end

  it 'reduces oversized feature payloads without retaining commands or credentials' do
    data['data'].first['commands'] = { 'padding' => 'x' * 170_000, 'token' => 'SYNTHETIC_TOKEN_MUST_NOT_LEAK' }
    data['data'] << { 'feature' => 'unrelated', 'properties' => { 'value' => { 'value' => 'x' * 170_000 } } }
    output = JSON.generate(transform)
    expect(output.bytesize).to be < 15_000
    expect(output).not_to match(/commands|SYNTHETIC_TOKEN_MUST_NOT_LEAK|unrelated/)
  end

  it "compares today's running totals with yesterday's completed day, separately for electricity and heat" do
    result = transform
    expect(result.fetch('energy')).to include('yesterday_kwh' => 15.8, 'trend' => 'down')
    expect(result.fetch('heat')).to include('yesterday_kwh' => 50, 'trend' => 'down')
    html = document(render('full', 'de'))
    expect(html.css('.vp-yesterday').map(&:text)).to eq(['Gestern15,8 kWh'])
    expect(html.css('.vp-energy > div')[1].css('.vp-yesterday, .vp-trend')).to be_empty
    expect(html.css('.vp-day-comparison').first.element_children.map { |node| node['class'] }).to eq(%w[vp-yesterday vp-comparison-arrow vp-today])
    expect(html.css('.vp-trend').map { |node| node['aria-label'] }).to all(eq('Heute niedriger als gestern'))
  end

  it 'keeps yesterday zero and distinguishes rising, falling and unchanged totals' do
    counter = feature('heating.power.consumption.summary.total')['properties']
    counter['currentDay']['value'] = 0
    counter['day']['value'] = [0, 0]
    expect(transform.fetch('energy')).to include('yesterday_kwh' => 0, 'trend' => 'flat')
    counter['currentDay']['value'] = 2
    expect(transform.dig('energy', 'trend')).to eq('up')
    counter['day']['value'][1] = 3
    expect(transform.dig('energy', 'trend')).to eq('down')
  end

  it 'does not manufacture a comparison from missing, invalid or old historical bins' do
    item = feature('heating.power.consumption.summary.total')
    item['properties']['day']['value'] = [12.34]
    expect(transform.fetch('energy')).to include('yesterday_kwh' => nil, 'trend' => nil)
    expect(document(render).css('.vp-yesterday').first.text).to eq('Yesterday—')
    item['properties']['day']['value'] = [12.34, 20]
    item['properties']['dayValueReadAt'] = { 'value' => '2026-10-17T18:00:00Z' }
    expect(transform.dig('energy', 'yesterday_kwh')).to be_nil
    item['properties'].delete('dayValueReadAt')
    item['properties']['day']['unit'] = 'kW'
    expect(transform.dig('energy', 'yesterday_kwh')).to be_nil
    item['properties']['day']['unit'] = 'kWh'
    item['timestamp'] = '2026-10-17T18:00:00Z'
    expect(transform.dig('energy', 'yesterday_kwh')).to be_nil
  end

  it 'sums historical heating and hot water bins with the same cooling scope as today' do
    remove_energy_totals
    data['data'] << reading('heating.power.consumption.heating', 'day', [3000, 5000], 'Wh')
    data['data'] << reading('heating.power.consumption.dhw', 'day', [1, 2])
    data['data'] << reading('heating.power.consumption.cooling', 'day', [1, 3])
    data['data'] << reading('heating.heat.production.heating', 'day', [12, 20])
    data['data'] << reading('heating.heat.production.dhw', 'day', [5, 8])
    data['data'] << reading('heating.heat.production.cooling', 'day', [9, 99])
    result = transform
    expect(result.fetch('energy')).to include('today_kwh' => 5, 'yesterday_kwh' => 10, 'trend' => 'down')
    expect(result.fetch('heat')).to include('today_kwh' => 17, 'yesterday_kwh' => 28, 'trend' => 'down')
    feature('heating.power.consumption.dhw')['properties']['day']['value'] = [1]
    expect(transform.dig('energy', 'yesterday_kwh')).to be_nil
  end

  it 'does not compare a device total against an incomplete historical use breakdown' do
    feature('heating.power.consumption.summary.total')['properties'].delete('day')
    data['data'] << reading('heating.power.consumption.heating', 'day', [8, 20])
    data['data'] << reading('heating.power.consumption.dhw', 'day', [4.34, 10])
    expect(transform.fetch('energy')).to include('today_kwh' => 12.34, 'yesterday_kwh' => nil, 'trend' => nil)
  end

  it 'uses calendar-day bins through a DST transition in the configured time zone' do
    item = feature('heating.power.consumption.summary.total')
    item['timestamp'] = '2026-10-25T23:45:00Z' # October 26 in Berlin, after the 25-hour day.
    expect(transform({ time_zone: 'Europe/Berlin' }, at: '2026-10-26T00:00:00Z').fetch('energy')).to include('yesterday_kwh' => 15.8)
    expect(transform({ time_zone: 'America/New_York' }, at: '2026-10-26T06:00:00Z').dig('energy', 'yesterday_kwh')).to be_nil
  end

  it 'keeps electrical consumption and thermal production independent' do
    result = transform
    expect(result.fetch('energy')).to include('power_kw' => 1.8, 'today_kwh' => 12.34, 'power_scope' => 'compressor')
    expect(result.fetch('heat')).to include('power_kw' => 7.2, 'today_kwh' => 48.6)
  end

  it 'prefers whole-device power over compressor-only power and converts watts' do
    data['data'] << { 'feature' => 'heating.power.consumption.current', 'timestamp' => now,
                      'properties' => { 'value' => { 'value' => 2400, 'unit' => 'watt' } } }
    expect(transform.fetch('energy')).to include('power_kw' => 2.4, 'power_scope' => 'device')
  end

  it 'converts watt-hours and preserves zero consumption' do
    feature('heating.compressors.0.power.consumption.current')['properties']['value']['value'] = 0
    counter = feature('heating.power.consumption.summary.total')['properties']['currentDay']
    counter.merge!('value' => 12340, 'unit' => 'wattHour')
    expect(transform.fetch('energy')).to include('power_kw' => 0, 'today_kwh' => 12.34)
  end

  it 'does not infer absent thermal output from electrical power or COP' do
    data['data'].reject! { |item| item['feature'].include?('.heat.production.') }
    expect(transform.fetch('heat')).to include('power_kw' => nil, 'today_kwh' => nil)
  end

  it 'rejects wrong units, negative readings and yesterday counters' do
    feature('heating.compressors.0.power.consumption.current')['properties']['value']['unit'] = 'celsius'
    feature('heating.compressors.0.heat.production.current')['properties']['value']['value'] = -1
    feature('heating.power.consumption.summary.total')['timestamp'] = '2026-10-17T23:00:00+02:00'
    feature('heating.heat.production.total')['timestamp'] = '2026-10-17T23:00:00+02:00'
    result = transform
    expect(result.fetch('energy')).to include('power_kw' => nil, 'today_kwh' => nil)
    expect(result.fetch('heat')).to include('power_kw' => nil, 'today_kwh' => nil)
  end

  it 'invalidates the previous local day at midnight even when UTC is still yesterday' do
    result = transform({ time_zone: 'Europe/Berlin' }, at: '2026-10-18T22:30:00Z')
    expect(result.dig('energy', 'today_kwh')).to be_nil
    expect(result.dig('heat', 'today_kwh')).to be_nil
  end


  def reading(name, property, value, unit = 'kWh', timestamp: '2026-10-18T18:00:00Z')
    { 'feature' => name, 'timestamp' => timestamp, 'isEnabled' => true,
      'properties' => { property => { 'value' => value, 'unit' => unit } } }
  end

  def remove_energy_totals
    data['data'].reject! { |item| item['feature'].match?(/\.(power\.consumption|heat\.production)\./) }
  end

  it 'never adds component counters to the reported device total' do
    data['data'] << reading('heating.power.consumption.summary.heating', 'currentDay', 10)
    data['data'] << reading('heating.power.consumption.summary.dhw', 'currentDay', 4)
    expect(transform.dig('energy', 'today_kwh')).to eq(12.34)
  end

  it 'sums heating and DHW and only adds valid cooling to electrical consumption' do
    remove_energy_totals
    data['data'] << reading('heating.power.consumption.summary.heating', 'currentDay', 10)
    data['data'] << reading('heating.power.consumption.summary.dhw', 'currentDay', 4)
    expect(transform.fetch('energy')).to include('today_kwh' => 14, 'today_scope' => 'heating_dhw')
    data['data'] << reading('heating.power.consumption.summary.cooling', 'currentDay', 2)
    expect(transform.fetch('energy')).to include('today_kwh' => 16, 'today_scope' => 'heating_dhw_cooling')
    data['data'].last['timestamp'] = '2026-10-17T18:00:00Z'
    expect(transform.fetch('energy')).to include('today_kwh' => nil, 'today_outdated' => true)
  end

  it 'does not silently treat a missing DHW component as zero' do
    remove_energy_totals
    data['data'] << reading('heating.power.consumption.summary.heating', 'currentDay', 10)
    expect(transform.dig('energy', 'today_kwh')).to be_nil
  end

  it 'excludes cooling from the thermal heating and DHW fallback' do
    remove_energy_totals
    data['data'] << reading('heating.heat.production.summary.heating', 'currentDay', 28)
    data['data'] << reading('heating.heat.production.summary.dhw', 'currentDay', 7)
    data['data'] << reading('heating.heat.production.summary.cooling', 'currentDay', 3)
    expect(transform.fetch('heat')).to include('today_kwh' => 35, 'today_scope' => 'heating_dhw')
  end

  it 'uses only the newest legacy day bin and preserves an actual zero' do
    remove_energy_totals
    data['data'] << reading('heating.power.consumption.total', 'day', [7.5, 30, 40, 50])
    data['data'] << reading('heating.heat.production.total', 'day', [0, 30])
    expect(transform.dig('energy', 'today_kwh')).to eq(7.5)
    expect(transform.dig('heat', 'today_kwh')).to eq(0)
  end

  it 'withholds counters with missing or invalid timestamps' do
    remove_energy_totals
    data['data'] << reading('heating.power.consumption.total', 'day', [7.5, 30], timestamp: nil)
    expect(transform.dig('energy', 'today_kwh')).to be_nil
    data['data'].last['timestamp'] = 'not-a-date'
    expect(transform.dig('energy', 'today_kwh')).to be_nil
  end

  it 'gives current power its own stale indicator without marking fresh temperatures stale' do
    feature('heating.compressors.0.power.consumption.current')['timestamp'] = '2026-10-18T10:00:00Z'
    result = transform
    expect(result.fetch('energy')).to include('power_kw' => 1.8, 'power_stale' => true, 'today_stale' => false)
    expect(result.dig('freshness', 'stale')).to be(false)
  end

  it 'uses configured electrical and thermal overrides with their own component scopes' do
    data['data'] << reading('heating.heatingRod.power.consumption.current', 'value', 3000, 'W')
    data['data'] << reading('heating.heatingRod.heat.production.dhw', 'day', [2500, 3000], 'Wh')
    result = transform(current_power_feature: 'heating.heatingRod.power.consumption.current',
                       daily_heat_feature: 'heating.heatingRod.heat.production.dhw')
    expect(result.fetch('energy')).to include('power_kw' => 3, 'power_scope' => 'heater')
    expect(result.fetch('heat')).to include('today_kwh' => 2.5, 'today_scope' => 'heater')
    result = transform(current_power_feature: 'heating.compressors.0.heat.production.current',
                       daily_heat_feature: 'heating.power.consumption.summary.total')
    expect(result.dig('energy', 'power_kw')).to be_nil
    expect(result.dig('heat', 'today_kwh')).to be_nil
  end

  def combined_heat(heating_stamp: '2026-10-18T18:00:00Z', dhw_stamp: '2026-10-18T10:00:00Z')
    remove_energy_totals
    data['data'] << reading('heating.heat.production.summary.heating', 'currentDay', 28, timestamp: heating_stamp)
    data['data'] << reading('heating.heat.production.summary.dhw', 'currentDay', 7, timestamp: dhw_stamp)
  end

  it 'identifies an old DHW component without concealing the conservative age of the sum' do
    combined_heat
    heat = transform.fetch('heat')
    expect(heat).to include('today_kwh' => 35, 'today_scope' => 'heating_dhw', 'today_stale' => true)
    expect(heat.fetch('today_components')).to contain_exactly(
      include('scope' => 'heating', 'stale' => false, 'updated' => include('20:00')),
      include('scope' => 'dhw', 'stale' => true, 'updated' => include('12:00'))
    )
    expect(heat.fetch('today_updated')).to include('12:00')
    feature('heating.heat.production.summary.heating')['properties']['currentDay']['value'] = 30
    expect(transform.dig('heat', 'today_kwh')).to eq(37)
  end

  it 'identifies old heating independently of a fresh hot-water counter' do
    combined_heat(heating_stamp: '2026-10-18T10:00:00Z', dhw_stamp: '2026-10-18T18:00:00Z')
    expect(transform.dig('heat', 'today_components')).to contain_exactly(
      include('scope' => 'heating', 'stale' => true), include('scope' => 'dhw', 'stale' => false)
    )
  end

  it 'keeps both age warnings when both components are old' do
    combined_heat(heating_stamp: '2026-10-18T10:00:00Z')
    expect(transform.dig('heat', 'today_components')).to all(include('stale' => true))
  end

  it 'withholds a combined total if either component is from yesterday' do
    combined_heat(dhw_stamp: '2026-10-17T18:00:00Z')
    expect(transform.fetch('heat')).to include('today_kwh' => nil, 'today_outdated' => true)
    expect(transform.dig('heat', 'today_components')).to be_nil
  end

  it 'preserves component metadata for electricity including cooling' do
    remove_energy_totals
    %w[heating dhw cooling].each do |scope|
      data['data'] << reading("heating.power.consumption.summary.#{scope}", 'currentDay', 2)
    end
    energy = transform.fetch('energy')
    expect(energy).to include('today_kwh' => 6, 'today_scope' => 'heating_dhw_cooling', 'today_stale' => false)
    expect(energy.fetch('today_components').map { |component| component['scope'] }).to eq(%w[heating dhw cooling])
    expect(energy.fetch('today_components')).to all(include('stale' => false))
  end

  it 'keeps device-total timestamps and age unchanged' do
    feature('heating.heat.production.total')['timestamp'] = '2026-10-18T10:00:00Z'
    expect(transform.fetch('heat')).to include('today_kwh' => 48.6, 'today_scope' => 'device', 'today_stale' => true)
    expect(transform.dig('heat', 'today_components')).to be_nil
  end

  %w[en de].each do |language|
    %w[full half_horizontal half_vertical quadrant].each do |view|
      it "keeps old counters visible without outdated labels in #{language} #{view}" do
        combined_heat
        screen = render(view, language)
        expect(screen).to have_no_transform_error.and(have_no_leaked_text)
        heat_tile = document(screen).css('.vp-energy > div')[1]
        note = heat_tile.at_css('.vp-energy-note').text.gsub(/\s+/, ' ').strip
        expect(document(screen).at_css('.vp').text).not_to match(/Stale data|Daten veraltet/)
        expect(note).to include(language == 'de' ? 'Gesamtes Gerät' : 'Whole device')
        expect(heat_tile.css('.vp-energy-asof')).to be_empty
        expect(document(screen).at_css('.vp-footer').text).to include('20:00')
        expect(heat_tile.at_css('.vp-energy-value').text).to include('35')
      end
    end
  end

  it 'prefers the documented total feature over compatibility aliases' do
    data['data'] << reading('heating.power.consumption.total', 'day', [17, 24])
    data['data'] << reading('heating.heat.production.summary.total', 'currentDay', 99)
    result = transform
    expect(result.fetch('energy')).to include('today_kwh' => 17, 'today_scope' => 'device')
    expect(result.fetch('heat')).to include('today_kwh' => 48.6, 'today_scope' => 'device')
  end

  it 'retains local time conversion while omitting zone indicators on component timestamps' do
    combined_heat
    result = transform(language: 'de', time_zone: 'Europe/Berlin')
    expect(result.dig('freshness', 'oldest_sensor')).to eq('18.10.2026, 20:00')
    expect(result.dig('heat', 'today_components').map { |item| item['updated'] }).to eq([
      '18.10.2026, 20:00', '18.10.2026, 12:00'
    ])
  end

  [
    ['Europe/Berlin', 'de-DE', '18.10.2026', '20:00'],
    ['America/New_York', 'en-US', '10/18/2026', '14:00'],
    ['Europe/London', 'en-GB', '18/10/2026', '19:00'],
    ['Asia/Tokyo', 'ja-JP', '2026/10/19', '03:00'],
    ['UTC', 'sv-SE', '2026-10-18', '18:00']
  ].each do |zone, locale, date, time|
    %w[en de].each do |language|
      it "uses #{zone} regional dates independently of #{language} labels" do
        result = transform(language:, time_zone: zone)
        expect(result.dig('freshness', 'date_locale')).to eq(locale)
        expect(result.dig('freshness', 'oldest_sensor')).to include(date, time)
        expect(result.dig('energy', 'power_updated')).to include(date, time)
        expect(result.dig('heat', 'today_updated')).to include(date, time)
      end
    end
  end

  it 'resolves country dates for timezone aliases and uses ISO dates for fixed offsets' do
    expect(transform(time_zone: 'US/Eastern').dig('freshness', 'oldest_sensor')).to include('10/18/2026', '14:00')
    expect(transform(time_zone: 'Etc/GMT+3').dig('freshness', 'oldest_sensor')).to include('2026-10-18', '15:00')
  end

  it 'keeps invalid-reference warnings without calculation or API annotations' do
    screen = render(custom_fields: { curve_points: 'invalid-json' })
    html = document(screen)
    expect(html.at_css('.vp-chart .vp-note').text).to include('Invalid reference points')
    expect(html.at_css('.vp').to_html).not_to match(/\bAPI\b|calculated|berechnet|berechnung/i)
    expect(html.at_css('.vp-chart svg')['aria-label']).to eq('Heating curve with supply limits')
  end

  it 'keeps the existing plugin target and the two different hosted OAuth encodings' do
    settings = YAML.load_file(File.join(__dir__, '..', 'src', 'settings.yml'))
    expect(settings).to include('id' => 510867, 'strategy' => 'polling', 'serverless_language' => 'node',
                               'oauth_enabled' => 'true', 'oauth_pkce_enabled' => 'yes',
                               'polling_headers' => 'Authorization=Bearer {{ oauth_access_token }}')
  end
end
