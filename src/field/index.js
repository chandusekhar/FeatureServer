const _ = require('lodash')
const createFieldAliases = require('./aliases')
const createStatFields = require('./statFields')
const { detectType, esriTypeMap } = require('./detect-types')

// computeFieldCollection exported as computeFieldObject to maintain backward compatability. TODO: change on next major revision
module.exports = { computeFieldsFromProperties, computeFieldObject: computeFieldsCollection, createStatFields, createFieldAliases }

const templates = {
  server: require('../../templates/server.json'),
  layer: require('../../templates/layer.json'),
  features: require('../../templates/features.json'),
  statistics: require('../../templates/statistics.json'),
  field: require('../../templates/field.json'),
  objectIDField: require('../../templates/oid-field.json')
}

// TODO this should be the only exported function
/**
 * generate a collection of esri field objects based on metadata or from inspection of a sample feature
 * @param {object} data
 * @param {string} requestContext
 * @param {object} options
 * @return {[object]}
 */
function computeFieldsCollection (data, requestContext, options = {}) {
  const metadata = data.metadata || {}
  const feature = data.features && data.features[0]
  const properties = feature ? feature.properties || feature.attributes : options.attributeSample
  let requestedFields

  // If no metadata fields defined, compute fields from data properties
  if (!metadata.fields && data.statistics) return computeFieldsFromProperties(data.statistics[0], requestContext, options).fields
  else if (!metadata.fields) return computeFieldsFromProperties(properties, requestContext, options).fields

  // Use metadata fields and request parameters to construct an array of requested fields
  requestedFields = computeFieldsFromMetadata(metadata.fields, options.outFields)

  // Generate warning if metadata fields don't match what is actually in the data
  if (properties) warnOnMetadataFieldDiscrepencies(requestedFields, properties)

  // Loop through the requested response fields and create a field object for each
  const responsefields = requestedFields.map(field => {
    return computeFieldObject(field.name, field.alias, field.type, field.length, requestContext)
  })

  // Ensure the OBJECTID field is first in the array
  responsefields.unshift(responsefields.splice(responsefields.findIndex(field => field.name === 'OBJECTID'), 1)[0])

  return responsefields
}

/**
 * generate an esri field object
 * @param {string} name
 * @param {string} alias
 * @param {string} type
 * @param {integer} length
 * @param {string} context
 * @return {object}
 */
function computeFieldObject (name, alias, type, length, context) {
  let outputField

  if (name === 'OBJECTID') {
    // Fields named OBJECTID get special definition with specific JSON template
    outputField = Object.assign({}, templates.objectIDField)
  } else {
    // Determine the ESRI field type
    const esriType = esriTypeMap(type.toLowerCase())

    outputField = Object.assign({}, templates.field, {
      name,
      type: esriType,
      alias: alias || name
    })

    // Use field length if defined, else defaults for String and Date types
    outputField.length = length || ((type === 'String') ? 128 : (type === 'Date') ? 36 : undefined)
  }

  // Layer service field objects have addition 'editable' and 'nullable' properties
  if (context === 'layer') {
    Object.assign(outputField, { editable: false, nullable: false })
  }

  // Create the field object by overriding a template with field specific property values
  return outputField
}

/**
 * builds esri json fields collection from geojson properties
 *
 * @param  {object} props
 * @param  {string} requestContext
 * @param  {object} options
 * @return {object} fields
 */
function computeFieldsFromProperties (properties, requestContext, options = {}) {
  // If no properties, return an empty array
  if (!properties) return []

  // Loop through the properties and construct an array of field objects
  const fields = Object.keys(properties).map((key) => {
    return computeFieldObject(key, key, detectType(properties[key]), undefined, requestContext)
  })

  // If this a layer service request, add OBJECTID field if its not already a field. Decorate the with additional properties needed for layer service
  if (requestContext === 'layer' && !_.find(fields, { name: 'OBJECTID' })) {
    fields.push(Object.assign({}, templates.objectIDField, {
      editable: false,
      nullable: false
    }))
  }

  // Ensure the OBJECTID field is first in the array
  fields.unshift(fields.splice(fields.findIndex(field => field.name === 'OBJECTID'), 1)[0])

  return { oidField: 'OBJECTID', fields }
}

/**
 * builds esri json fields collection from metadata
 * @param {[Object]} metadataFields collection of fields defined in metadata
 * @param {string} outFieldsParam request parameter that specifies which fields to reutrn in response
 * @return {[Object]} collection of esri json fields
 */
function computeFieldsFromMetadata (metadataFields, outFieldsParam) {
  // Clone metadata to prevent mutation
  let responseFields = _.clone(metadataFields)

  // Add OBJECTID if it isn't already a metadata field
  if (!_.find(metadataFields, {'name': 'OBJECTID'})) responseFields.push({name: 'OBJECTID'})

  // If outFields were specified and not wildcarded, create a subset of fields from metadata fields based on outFields param
  if (outFieldsParam && outFieldsParam !== '*') {
    // Split comma-delimited outFields
    const outFields = outFieldsParam.split(/\s*,\s*/)

    // Filter out fields that weren't included in the outFields param
    responseFields = responseFields.filter(field => {
      return outFields.includes(field.name)
    })
  }
  return responseFields
}

/**
 * Compare fields generated from metadata to properties of a data sample.
 * Warn if differences discovered
 * @param {*} metadataFields
 * @param {*} properties
 */
function warnOnMetadataFieldDiscrepencies (metadataFields, properties) {
  // build a comparison collection from the data samples properties
  let featureFields = Object.keys(properties).map(name => {
    return {
      name,
      type: detectType(properties[name])
    }
  })

  // Loop through fields generated from metadata
  metadataFields.forEach(field => {
    // Search data sample's fields for a match
    let featureField = _.find(featureFields, { name: field.name })
    if (!featureField) {
      // Warn if a field defined in metadata was not found in the sample feature's properties
      console.warn(`Metadata field ${field.name} (${field.type}) not found in feature properties object.`)
    } else if (field.name !== 'OBJECTID' && !(field.type === 'Date' && featureField.type === 'Integer') &&
      !(field.type === 'Double' && featureField.type === 'Integer') && field.type !== featureField.type) {
      // Warn if field defined in metadata has a type mismatch with sample feature's field. Exception for Double===Integer and Integer==Date (epoch time)
      console.warn(`Metadata field ${field.name} (${field.type}) has a type mismatch with feature property: ${featureField.name} (${featureField.type})`)
    }
  })
}
