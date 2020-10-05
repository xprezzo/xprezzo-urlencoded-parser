/**
 * xprezzo-urlencoded-parser
 * Copyright(c) 2020 Ben Ajenoui <info@seohero.io>
 * MIT Licensed
 */

'use strict'

/**
 * Module dependencies.
 * @private
 */

const bytes = require('xprezzo-raw-body').bytes
const contentType = require('content-type')
const createError = require('xprezzo-raw-body').httpErrors
const debug = require('xprezzo-raw-body').debug('xprezzo:urlencodedParser')
const deprecate = require('depd')('xpresso-urlencoded-parser')
const Reader = require('xprezzo-raw-body').Reader
const typeis = require('type-is')
const prop = new WeakMap()

/**
 * Cache of parser modules.
 */

const parsers = Object.create(null)

const checkParse = (req, res, next, self, charset) => {
  if (req._body) {
    debug('body already parsed')
    next()
    return false
  }
  // skip requests without bodies
  if (!typeis.hasBody(req)) {
    debug('skip empty body')
    next()
    return false
  }
  debug('content-type %j', req.headers['content-type'])
  // determine if request should be parsed
  if (!self.shouldParse(req)) {
    debug('skip parsing')
    next()
    return false
  }
  // assert charset
  if (charset !== 'utf-8') {
    debug('invalid charset')
    next(createError(415, 'unsupported charset "' + charset.toUpperCase() + '"', {
      charset: charset,
      type: 'charset.unsupported'
    }))
    return false
  }
  return true
}

function createReader () {
  const self = prop.get(this)
  return (req, res, next) => {
    const charset = getCharset(req) || 'utf-8'
    req.body = req.body || {}
    if (!checkParse(req, res, next, self, charset)) {
      return
    }
    Reader(req, res, next, (body) => {
      return body.length
        ? self.queryparse(body)
        : {}
    }, debug, {
      debug: debug,
      encoding: charset,
      inflate: self.parsedInflate,
      limit: self.parsedLimit,
      verify: self.parsedVerify
    })
  }
}

class UrlencodedParser {
  constructor (options) {
    const opts = options || {}

    // notice because option default will flip in next major
    if (opts.extended === undefined) {
      deprecate('undefined extended: provide extended option')
    }
    opts.parsedLimit = typeof opts.limit !== 'number'
      ? bytes.parse(opts.limit || '100kb')
      : opts.limit
    opts.parsedInflate = opts.inflate !== false
    opts.parsedType = opts.type || 'application/x-www-form-urlencoded'
    opts.parsedVerify = opts.verify || false

    if (opts.parsedVerify !== false && typeof opts.parsedVerify !== 'function') {
      throw new TypeError('option verify must be function')
    }
    // create the appropriate query parser
    opts.queryparse = opts.extended !== false
      ? extendedparser(opts)
      : simpleparser(opts)

    // create the appropriate type checking function
    opts.shouldParse = typeof opts.parsedType !== 'function'
      ? typeChecker(opts.parsedType)
      : opts.parsedType

    prop.set(this, opts)
    return createReader.call(this)
  }
}

/**
 * Get the extended query parser.
 *
 * @param {object} options
 */

const extendedparser = (options) => {
  let parameterLimit = options.parameterLimit !== undefined
    ? options.parameterLimit
    : 1000
  const parse = parser('qs')

  if (isNaN(parameterLimit) || parameterLimit < 1) {
    throw new TypeError('option parameterLimit must be a positive number')
  }

  if (isFinite(parameterLimit)) {
    parameterLimit = parameterLimit | 0
  }

  return function queryparse (body) {
    const paramCount = parameterCount(body, parameterLimit)

    if (paramCount === undefined) {
      debug('too many parameters')
      throw createError(413, 'too many parameters', {
        type: 'parameters.too.many'
      })
    }

    const arrayLimit = Math.max(100, paramCount)

    debug('parse extended urlencoding')
    return parse(body, {
      allowPrototypes: true,
      arrayLimit: arrayLimit,
      depth: Infinity,
      parameterLimit: parameterLimit
    })
  }
}

/**
 * Get the charset of a request.
 *
 * @param {object} req
 * @api private
 */

const getCharset = (req) => {
  try {
    return (contentType.parse(req).parameters.charset || '').toLowerCase()
  } catch (e) {
    return undefined
  }
}

/**
 * Count the number of parameters, stopping once limit reached
 *
 * @param {string} body
 * @param {number} limit
 * @api private
 */

const parameterCount = (body, limit) => {
  let count = 0
  let index = 0

  while ((index = body.indexOf('&', index)) !== -1) {
    count++
    index++

    if (count === limit) {
      return undefined
    }
  }

  return count
}

/**
 * Get parser for module name dynamically.
 *
 * @param {string} name
 * @return {function}
 * @api private
 */

const parser = (name) => {
  let mod = parsers[name]

  if (mod !== undefined) {
    return mod.parse
  }

  // this uses a switch for static require analysis
  switch (name) {
    case 'qs':
      mod = require('qs')
      break
    case 'querystring':
      mod = require('querystring')
      break
  }

  // store to prevent invoking require()
  parsers[name] = mod

  return mod.parse
}

/**
 * Get the simple query parser.
 *
 * @param {object} options
 */

const simpleparser = (options) => {
  let parameterLimit = options.parameterLimit !== undefined
    ? options.parameterLimit
    : 1000
  const parse = parser('querystring')

  if (isNaN(parameterLimit) || parameterLimit < 1) {
    throw new TypeError('option parameterLimit must be a positive number')
  }

  if (isFinite(parameterLimit)) {
    parameterLimit = parameterLimit | 0
  }

  return function queryparse (body) {
    const paramCount = parameterCount(body, parameterLimit)

    if (paramCount === undefined) {
      debug('too many parameters')
      throw createError(413, 'too many parameters', {
        type: 'parameters.too.many'
      })
    }

    debug('parse urlencoding')
    return parse(body, undefined, undefined, { maxKeys: parameterLimit })
  }
}

/**
 * Get the simple type checker.
 *
 * @param {string} type
 * @return {function}
 */

const typeChecker = (type) => {
  return function checkType (req) {
    return Boolean(typeis(req, type))
  }
}

/**
 * Module exports.
 */

module.exports = (options) => { return new UrlencodedParser(options) }
