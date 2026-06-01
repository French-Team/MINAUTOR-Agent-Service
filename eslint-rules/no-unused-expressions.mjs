/**
 * @fileoverview ESLint rule: no-unused-expressions
 *
 * Détecte les expression statements qui n'ont aucun effet de bord.
 * Ces expressions sont superflues — elles peuvent être supprimées
 * sans changer le comportement du programme.
 *
 * ❌ Flag:  1 + 1
 * ❌ Flag:  "hello"
 * ❌ Flag:  someVariable
 * ❌ Flag:  obj.prop
 * ❌ Flag:  a ? b : c
 * ❌ Flag:  arr[0]
 * ✅ Passe: foo()                        (appel de fonction)
 * ✅ Passe: x = 1                        (assignment)
 * ✅ Passe: ++i                          (incrémentation)
 * ✅ Passe: new Foo()                    (constructeur)
 * ✅ Passe: obj.prop = val               (assignment membre)
 * ✅ Passe: html`<div>`                  (tagged template)
 * ✅ Passe: val as Type                  (TS assertion — pas un expression statement)
 */

/** @import { Rule } from 'eslint' */

/** @type {Rule.RuleModule} */
export default {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow expression statements with no side effects',
    },
    messages: {
      unusedExpression:
        'Expression statement without side effects — it can be removed.',
    },
    schema: [],
  },

  create(context) {
    /**
     * Déballe les wrappers AST qui n'ont pas d'effet de bord par eux-mêmes
     * (TS assertions, parenthèses, chaînage optionnel).
     */
    function unwrap(node) {
      let inner = node
      while (
        inner
        && (
          inner.type === 'TSNonNullExpression'
          || inner.type === 'TSAsExpression'
          || inner.type === 'TSSatisfiesExpression'
          || inner.type === 'TSTypeAssertion'
          || inner.type === 'ParenthesizedExpression'
        )
      ) {
        inner = inner.expression
      }
      return inner
    }

    /**
     * Vérifie si un nœud d'expression produit un effet de bord.
     * Gère récursivement les wrappers TS, parenthèses, chaînage
     * optionnel (ChainExpression) et séquences (SequenceExpression).
     */
    function hasSideEffect(node) {
      const inner = unwrap(node)
      if (!inner) return false

      switch (inner.type) {
        // Appels et constructeurs → side-effect garanti
        case 'CallExpression':
        case 'OptionalCallExpression':
        case 'NewExpression':
        case 'ImportExpression':
          return true

        // Assignments → side-effect garanti
        case 'AssignmentExpression':
          return true

        // Incrémentation/décrémentation → side-effect garanti
        case 'UpdateExpression':
          return true

        // Tagged templates → le tag est une fonction appelée
        case 'TaggedTemplateExpression':
          return true

        // Yield/Await → side-effect (dans generator/async)
        case 'YieldExpression':
        case 'AwaitExpression':
          return true

        // Unaire avec delete → effet de bord garanti
        // ex: delete obj.prop
        case 'UnaryExpression':
          return inner.operator === 'delete'

        // Chaînage optionnel : déballe pour voir l'expression interne
        // ex: obj?.method() → ChainExpression(CallExpression) → side-effect
        case 'ChainExpression':
          return hasSideEffect(inner.expression)

        // Séquence : seul le dernier élément a un side-effect utile
        // ex: (a, b, foo()) → SequenceExpression → dernier = CallExpression
        case 'SequenceExpression':
          return hasSideEffect(inner.expressions[inner.expressions.length - 1])

        default:
          return false
      }
    }

    return {
      ExpressionStatement(node) {
        // Déballer les wrappers superficiels (le déballage profond
        // est géré récursivement dans hasSideEffect)
        const expr = node.expression
        if (!expr) return
        if (!hasSideEffect(expr)) {
          context.report({
            node,
            messageId: 'unusedExpression',
          })
        }
      },
    }
  },
}
