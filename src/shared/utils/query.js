'use strict';

/**
 * @file Query helpers for list endpoints: zod pagination fields, page metadata and
 * safe regular expressions for free-text search.
 */
const { z } = require('zod');

/** Shared zod fields: ?page=1&limit=20 (limit max 100). */
const paginationFields = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

/**
 * Pagination metadata for a list response.
 * @param {{page: number, limit: number, total: number}} params
 * @returns {{page: number, limit: number, total: number, totalPages: number}}
 */
function buildPageMeta({ page, limit, total }) {
  return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

/**
 * Case-insensitive "contains" regex for user input (special characters escaped).
 * @param {string} text
 * @returns {RegExp}
 */
function containsRegex(text) {
  return new RegExp(String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}

/**
 * Mongo sort object from '-field' / 'field'.
 * @param {string} sort
 * @returns {Object<string, 1|-1>} Always adds _id as a stable tie-breaker.
 */
function toSort(sort) {
  const desc = sort.startsWith('-');
  const field = desc ? sort.slice(1) : sort;
  return { [field]: desc ? -1 : 1, _id: desc ? -1 : 1 };
}

module.exports = { paginationFields, buildPageMeta, containsRegex, toSort };
