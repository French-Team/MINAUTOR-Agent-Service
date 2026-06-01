/**
 * @fileoverview ESLint rule: no-useless-catch
 *
 * Détecte les catch blocks qui ne font que rethrow l'erreur attrapée.
 * Ces catch sont superflus — le try/catch peut être supprimé sans
 * changement de comportement.
 *
 * ❌ Flag:  catch (e) { throw e }
 * ❌ Flag:  catch (err) { throw err }
 * ✅ Passe: catch (e) { cleanup(); throw e }     (side-effect avant rethrow)
 * ✅ Passe: catch (e) { throw new Error(e) }      (transformation de l'erreur)
 * ✅ Passe: catch { throw new Error('always') }   (pas de paramètre à rethrow)
 * ✅ Passe: catch (e) { log(e); throw e }         (log + rethrow — utile)
 */

/** @import { Rule } from 'eslint' */

/** @type {Rule.RuleModule} */
export default {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow catch clauses that only rethrow the caught error without any side-effect',
    },
    messages: {
      uselessCatch:
        'Useless catch — it only rethrows the caught error. '
        + 'Remove the try/catch entirely and let the error propagate naturally.',
    },
    schema: [],
  },

  create(context) {
    return {
      CatchClause(node) {
        // Le catch doit avoir un paramètre nommé (ex: `catch (e) { ... }`)
        if (!node.param || !node.param.name) return

        const paramName = node.param.name
        const body = node.body

        // Le body du catch doit contenir exactement une instruction
        if (!body || !body.body || body.body.length !== 1) return

        const statement = body.body[0]

        // L'instruction doit être un ThrowStatement
        if (statement.type !== 'ThrowStatement') return

        // L'argument throwé doit être un Identifier
        if (!statement.argument || statement.argument.type !== 'Identifier') return

        // Le nom de l'identifiant doit correspondre au paramètre catché
        if (statement.argument.name !== paramName) return

        context.report({
          node,
          messageId: 'uselessCatch',
        })
      },
    }
  },
}
