function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function convertNamedPlaceholdersToPositional(body, variables) {
  if (typeof body !== 'string' || body.length === 0) {
    throw Object.assign(new Error('body must be a non-empty string'), { statusCode: 400 });
  }

  if (!Array.isArray(variables)) {
    throw Object.assign(new Error('variables must be an array'), { statusCode: 400 });
  }

  const variablesOrder = [];
  const mapping = {};
  let bodyMeta = body;

  variables.forEach((rawName, index) => {
    if (typeof rawName !== 'string' || rawName.trim() === '') {
      throw Object.assign(
        new Error(`variables[${index}] must be a non-empty string`),
        { statusCode: 400 }
      );
    }

    const name = rawName.trim();
    const position = index + 1;
    const namedPattern = new RegExp(`{{\\s*${escapeRegex(name)}\\s*}}`, 'g');

    if (!namedPattern.test(bodyMeta)) {
      throw Object.assign(
        new Error(`Variable "${name}" is declared but not found in body as {{${name}}}`),
        { statusCode: 400 }
      );
    }

    bodyMeta = bodyMeta.replace(
      new RegExp(`{{\\s*${escapeRegex(name)}\\s*}}`, 'g'),
      `{{${position}}}`
    );

    variablesOrder.push(name);
    mapping[String(position)] = name;
  });

  const leftover = bodyMeta.match(/{{\s*[a-zA-Z_][a-zA-Z0-9_]*\s*}}/);
  if (leftover) {
    throw Object.assign(
      new Error(`Body contains an unmapped named placeholder: ${leftover[0]}`),
      { statusCode: 400 }
    );
  }

  return {
    bodyMeta,
    variablesOrder,
    mapping
  };
}

function buildExampleBodyText(variablesOrder, examples) {
  if (!examples || typeof examples !== 'object' || Array.isArray(examples)) {
    throw Object.assign(
      new Error('examples must be an object with a key for each variable'),
      { statusCode: 400 }
    );
  }

  return variablesOrder.map((name) => {
    const value = examples[name];

    if (value === undefined || value === null || String(value).trim() === '') {
      throw Object.assign(
        new Error(`examples.${name} is required`),
        { statusCode: 400 }
      );
    }

    return String(value);
  });
}

function buildPositionalMapping(variablesOrder, variables) {
  if (!variables || typeof variables !== 'object' || Array.isArray(variables)) {
    throw Object.assign(
      new Error('variables must be an object with a key for each template variable'),
      { statusCode: 400 }
    );
  }

  return variablesOrder.map((name, index) => {
    const value = variables[name];

    if (value === undefined || value === null) {
      throw Object.assign(
        new Error(`variables.${name} is required for this template`),
        { statusCode: 400 }
      );
    }

    return {
      schema_property_name: String(index + 1),
      schema_property_value: String(value)
    };
  });
}

module.exports = {
  convertNamedPlaceholdersToPositional,
  buildExampleBodyText,
  buildPositionalMapping
};
