import * as vscode from 'vscode';
import builtinExcludes from './builtin-excludes.json';

/**
 * Built-in patterns that are always excluded unless explicitly included.
 */
const BUILTIN_EXCLUDES: readonly string[] = builtinExcludes;

/**
 * Merged filter rules, resolved from built-in defaults + user config + project config.
 *
 * Merge strategy:
 *   exclude = builtin + global(seenIt.exclude) + workspace(seenIt.exclude)   (union)
 *   include = workspace(seenIt.include) ?? global(seenIt.include)             (project overrides user)
 *   final   = exclude - include
 */
export interface FilterRules {
  exclude: string[];
  include: string[];
}

/**
 * Read the merged filter rules from all configuration scopes.
 * Uses `inspect()` to access user-level (global) and project-level (workspace) values separately.
 */
export function getFilterRules(): FilterRules {
  const config = vscode.workspace.getConfiguration('seenIt');

  // ── exclude: union of builtin + global + workspace ──
  const excludeInspection = config.inspect<string[]>('exclude');
  const globalExcludes = excludeInspection?.globalValue ?? [];
  const workspaceExcludes = excludeInspection?.workspaceValue ?? [];
  const exclude = [...BUILTIN_EXCLUDES, ...globalExcludes, ...workspaceExcludes];

  // ── include: project-level overrides user-level ──
  const includeInspection = config.inspect<string[]>('include');
  const include = includeInspection?.workspaceValue ?? includeInspection?.globalValue ?? [];

  return { exclude, include };
}

/**
 * Check if a relative path (from workspace root) should be tracked.
 *
 * Logic: match against (exclude - include).
 * A file is tracked only if it matches NO exclude pattern,
 * OR it matches an include pattern that overrides the exclude.
 */
export function isPathTrackable(relativePath: string, rules: FilterRules): boolean {
  const excluded = rules.exclude.some((p) => matchesPattern(relativePath, p));
  if (!excluded) {
    return true;
  }
  // Excluded — but an include pattern can rescue it
  const included = rules.include.some((p) => matchesPattern(relativePath, p));
  return included;
}

/**
 * Check if a relative path matches a glob pattern.
 * Supports plain names, wildcard (*), globstar (**), and single-char (?).
 */
export function matchesPattern(relativePath: string, pattern: string): boolean {
  const path = relativePath.replace(/\\/g, '/');
  const pat = pattern.replace(/\\/g, '/').replace(/\/+$/, ''); // strip trailing slashes

  // Fast path: no wildcards — match as directory prefix or file name
  if (!pat.includes('*') && !pat.includes('?')) {
    // Exact match
    if (path === pat) {
      return true;
    }
    // Directory prefix: "node_modules" matches "node_modules/foo/bar"
    if (path.startsWith(pat + '/')) {
      return true;
    }
    // File name anywhere in path: "README.md" matches "docs/README.md"
    const segments = path.split('/');
    if (segments.some((s) => s === pat)) {
      return true;
    }
    return false;
  }

  // Convert glob to regex
  const regexStr =
    '^' +
    pat
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex specials (* ? excluded)
      .replace(/\*\*\//g, '(%PARENT%|%EMPTY%)') // placeholder for **/
      .replace(/\*\*/g, '%GLOBSTAR%') // placeholder for ** (non-trailing-slash)
      .replace(/\*/g, '[^/]*') // * → match within segment
      .replace(/\?/g, '[^/]') // ? → single char
      .replace(/%PARENT%/g, '(.+/)?') // **/ → optional leading path
      .replace(/%EMPTY%/g, '') // handle leading **/
      .replace(/%GLOBSTAR%/g, '.*') + // ** → anything
    '$';

  return new RegExp(regexStr).test(path);
}
