(function (root, factory) {
  const utilities = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = utilities;
  } else {
    root.exportUtils = utilities;
  }
})(globalThis, function () {
  function escapeIcsText(value) {
    return String(value ?? "")
      .replace(/\\/g, "\\\\")
      .replace(/\r\n|\r|\n/g, "\\n")
      .replace(/,/g, "\\,")
      .replace(/;/g, "\\;");
  }

  function csvCell(value) {
    const text = String(value ?? "");
    const safeText = /^[\u0000-\u0020]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)
      ? `'${text}`
      : text;
    return `"${safeText.replace(/"/g, '""')}"`;
  }

  return { escapeIcsText, csvCell };
});
