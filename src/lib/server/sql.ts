export function addSqlParameter(parameters: unknown[], value: unknown) {
  parameters.push(value);
  return `$${parameters.length}`;
}

export function addSqlParameterList(parameters: unknown[], values: unknown[]) {
  return values.map((value) => addSqlParameter(parameters, value)).join(", ");
}
