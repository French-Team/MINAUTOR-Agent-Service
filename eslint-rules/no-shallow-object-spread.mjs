/**
 * @fileoverview ESLint rule: no-shallow-object-spread
 *
 * Détecte les spreads superficiels de constantes qui contiennent
 * des objets ou tableaux imbriqués — source du bug de références
 * partagées (ex: `{ ...DEFAULT_STATS }` où `counts: {}` est partagé
 * entre toutes les instances par le spread superficiel).
 *
 * ✅ Passe:   `{ ...DEFAULT_CONFIG }`   (que des primitifs → safe)
 * ✅ Passe:   `{ ...objVar }`           (variable dynamique → pas un const literal)
 * ❌ Flag:    `{ ...DEFAULT_STATS }`    (contient `counts: {}` → partagé par ref)
 * ❌ Flag:    `{ ...CONFIG }`           (contient `list: ['a']` → partagé par ref)
 * ❌ Flag:    `{ ...CONFIG }`           (même avec `as const` → ref partagée)
 *
 * Solution recommandée : extraire un helper `freshDefaultXxx()` qui retourne
 * des objets/tableaux neufs à chaque appel.
 */

/** @import { Rule } from 'eslint' */

/** @type {Rule.RuleModule} */
export default {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow spreading constants that contain nested objects or arrays (shallow copy bug)',
    },
    messages: {
      shallowSpread:
        'Shallow spread of constant "{{name}}" — it contains nested objects/arrays. '
        + 'Extract a helper like fresh{{PascalName}}() that returns new objects/arrays each call '
        + '(see src/learning.ts freshDefaultStats() for the pattern).',
    },
    schema: [],
  },

  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode()

    /**
     * Vérifie récursivement si un nœud AST contient des objets ou tableaux
     * littéraux imbriqués (un niveau de profondeur suffit — les primitifs
     * ne posent pas de problème avec le spread superficiel).
     */
    function hasNestedObjectOrArray(node) {
      if (!node) return false

      if (node.type === 'ObjectExpression') {
        for (const prop of node.properties) {
          if (prop.type === 'SpreadElement') continue
          if (prop.type === 'Property' && prop.value) {
            const vt = prop.value.type
            if (vt === 'ObjectExpression' || vt === 'ArrayExpression') {
              return true
            }
            // Recurse pour les objets imbriqués plus profonds
            if (hasNestedObjectOrArray(prop.value)) return true
          }
        }
        return false
      }

      if (node.type === 'ArrayExpression') {
        for (const elem of node.elements) {
          if (!elem) continue
          const et = elem.type
          if (et === 'ObjectExpression' || et === 'ArrayExpression') {
            return true
          }
          if (hasNestedObjectOrArray(elem)) return true
        }
        return false
      }

      return false
    }

    /**
     * Déballe les wrappers AST que TypeScript-ESLint peut ajouter autour
     * d'une expression : `as const`, `satisfies T`, parenthèses, etc.
     * Retourne le nœud littéral sous-jacent, ou null si pas trouvé.
     */
    function getUnderlyingExpression(node) {
      if (!node) return null
      const type = node.type
      if (
        type === 'TSAsExpression'
        || type === 'TSSatisfiesExpression'
        || type === 'TSTypeAssertion'
        || type === 'ParenthesizedExpression'
      ) {
        return getUnderlyingExpression(node.expression)
      }
      return node
    }

    /**
     * Remonte la chaîne des scopes pour trouver une variable par son nom.
     */
    function findVariable(name, scope) {
      let current = scope
      while (current) {
        const variable = current.variables.find(v => v.name === name)
        if (variable) return variable
        current = current.upper
      }
      return null
    }

    /**
     * Transforme une constante en PascalCase pour le message d'erreur.
     * Ex: DEFAULT_STATS → DefaultStats, MY_CONST_VAL → MyConstVal
     */
    function toPascalCase(name) {
      return name
        .toLowerCase()
        .split('_')
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join('')
    }

    /**
     * Vérifie si un SpreadElement cible une constante dont l'initialiseur
     * contient des objets/tableaux imbriqués.
     */
    function checkSpread(identifier) {
      const scope = sourceCode.getScope?.(identifier) ?? context.getScope?.()
      if (!scope) return

      const variable = findVariable(identifier.name, scope)
      if (!variable || !variable.defs || variable.defs.length === 0) return

      const def = variable.defs[0]
      if (def.type !== 'Variable') return

      const init = def.node.init
      if (!init) return

      // Déballer les wrappers TS (as const, satisfies, parenthèses)
      const unwrapped = getUnderlyingExpression(init)
      if (!unwrapped) return

      // Ne pas flaguer les spreads de variables non-littérales
      // (ex: fonction, paramètre, import — on ne peut pas vérifier)
      if (unwrapped.type !== 'ObjectExpression' && unwrapped.type !== 'ArrayExpression') return

      if (hasNestedObjectOrArray(unwrapped)) {
        context.report({
          node: identifier,
          messageId: 'shallowSpread',
          data: {
            name: identifier.name,
            PascalName: toPascalCase(identifier.name),
          },
        })
      }
    }

    return {
      SpreadElement(node) {
        if (node.argument && node.argument.type === 'Identifier') {
          checkSpread(node.argument)
        }
      },
    }
  },
}
