export function validateJsonSchema(value, schema) {
  const errors = [];
  validateValue({ errors, path: "", root: schema, schema, value });
  return errors;
}

function validateValue({ errors, path, root, schema, value }) {
  if (schema.$ref) {
    validateValue({
      errors,
      path,
      root,
      schema: resolveLocalReference(root, schema.$ref),
      value,
    });
  }

  if (schema.anyOf) {
    const accepted = schema.anyOf.some((branch) => {
      const branchErrors = [];
      validateValue({
        errors: branchErrors,
        path,
        root,
        schema: branch,
        value,
      });
      return branchErrors.length === 0;
    });
    if (!accepted) {
      errors.push(`${displayPath(path)} must match one allowed schema`);
      return;
    }
  }

  for (const branch of schema.allOf ?? []) {
    validateValue({ errors, path, root, schema: branch, value });
  }

  if (schema.type && !matchesType(value, schema.type)) {
    errors.push(`${displayPath(path)} must be ${schema.type}`);
    return;
  }

  if (schema.type === "object") {
    validateObject({ errors, path, root, schema, value });
  } else if (schema.type === "array") {
    value.forEach((item, index) =>
      validateValue({
        errors,
        path: `${path}/${index}`,
        root,
        schema: schema.items,
        value: item,
      }),
    );
  } else if (schema.type === "string") {
    validateString({ errors, path, schema, value });
  }
}

function validateObject({ errors, path, root, schema, value }) {
  for (const key of schema.required ?? []) {
    if (!Object.hasOwn(value, key)) {
      errors.push(`${displayPath(path)} must have required property ${key}`);
    }
  }

  const properties = schema.properties ?? {};
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(properties, key)) {
        errors.push(`${displayPath(path)} must not have property ${key}`);
      }
    }
  }

  for (const [key, propertySchema] of Object.entries(properties)) {
    if (Object.hasOwn(value, key)) {
      validateValue({
        errors,
        path: `${path}/${escapeJsonPointer(key)}`,
        root,
        schema: propertySchema,
        value: value[key],
      });
    }
  }
}

function validateString({ errors, path, schema, value }) {
  if (schema.minLength !== undefined && [...value].length < schema.minLength) {
    errors.push(
      `${displayPath(path)} must have at least ${schema.minLength} character(s)`,
    );
  }
  if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) {
    errors.push(`${displayPath(path)} must match pattern ${schema.pattern}`);
  }
  if (schema.format === "date" && !isCalendarDate(value)) {
    errors.push(`${displayPath(path)} must be a valid date`);
  }
}

function matchesType(value, type) {
  if (type === "null") {
    return value === null;
  }
  if (type === "array") {
    return Array.isArray(value);
  }
  if (type === "object") {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  return typeof value === type;
}

function resolveLocalReference(root, reference) {
  if (!reference.startsWith("#/")) {
    throw new Error(`未対応のJSON Schema referenceです: ${reference}`);
  }
  let current = root;
  for (const encodedSegment of reference.slice(2).split("/")) {
    const segment = encodedSegment.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!current || !Object.hasOwn(current, segment)) {
      throw new Error(`JSON Schema referenceを解決できません: ${reference}`);
    }
    current = current[segment];
  }
  return current;
}

function isCalendarDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) {
    return false;
  }
  const days = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day >= 1 && day <= days[month - 1];
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function escapeJsonPointer(segment) {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

function displayPath(path) {
  return path || "/";
}
