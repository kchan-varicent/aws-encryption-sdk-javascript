/*
 * Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"). You may not use
 * this file except in compliance with the License. A copy of the License is
 * located at
 *
 *     http://aws.amazon.com/apache2.0/
 *
 * or in the "license" file accompanying this file. This file is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
 * implied. See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { immutableClass, readOnlyProperty } from './immutable_class'
import {
  Keyring, // eslint-disable-line no-unused-vars
  KeyringNode,
  KeyringWebCrypto
} from './keyring'
import { EncryptionContext, SupportedAlgorithmSuites, EncryptionMaterial, DecryptionMaterial } from './types' // eslint-disable-line no-unused-vars
import { needs } from './needs'
import { EncryptedDataKey } from './encrypted_data_key' // eslint-disable-line no-unused-vars
import { NodeAlgorithmSuite } from './node_algorithms' // eslint-disable-line no-unused-vars
import { WebCryptoAlgorithmSuite } from './web_crypto_algorithms' // eslint-disable-line no-unused-vars

export const MultiKeyringNode = buildMultiKeyring(KeyringNode as KeyRingConstructible<NodeAlgorithmSuite>)
export const MultiKeyringWebCrypto = buildMultiKeyring(KeyringWebCrypto as KeyRingConstructible<WebCryptoAlgorithmSuite>)

function buildMultiKeyring<S extends SupportedAlgorithmSuites> (BaseKeyring: KeyRingConstructible<S>): MultiKeyringConstructible<S> {
  class MultiKeyring extends BaseKeyring {
    public readonly generator?: Keyring<S>
    public readonly children!: ReadonlyArray<Keyring<S>>
    constructor ({ generator, children = [] }: MultiKeyringInput<S>) {
      super()
      /* Precondition: MultiKeyring must have keyrings. */
      needs(generator || children.length, 'Noop MultiKeyring is not supported.')
      /* Precondition: generator must be a Keyring. */
      needs(!!generator === generator instanceof BaseKeyring, 'Generator must be a Keyring')
      /* Precondition: All children must be Keyrings. */
      needs(children.every(kr => kr instanceof BaseKeyring), 'Child must be a Keyring')

      readOnlyProperty(this, 'children', Object.freeze(children.slice()))
      readOnlyProperty(this, 'generator', generator)
    }

    async _onEncrypt (material: EncryptionMaterial<S>, context?: EncryptionContext) {
      const generated = this.generator
        ? await this.generator.onEncrypt(material, context)
        : material

      /* Precondition: A Generator Keyring *must* ensure generated material. */
      needs(this.generator && generated.hasUnencryptedDataKey, 'Generator Keyring has not generated material.')
      /* Precondition: Only Keyrings explicitly designated as generators can generate material. */
      needs(generated.hasUnencryptedDataKey, 'Only Keyrings explicitly designated as generators can generate material.')

      /* By default this is a serial operation.  A keyring _may_ perform an expensive operation
      * or create resource constraints such that encrypting with multiple keyrings could
      * fail in unexpected ways.
      * Additionally, "downstream" keyrings may make choices about the EncryptedDataKeys they
      * append based on already appended EDK's.
      */
      for (const keyring of this.children) {
        await keyring.onEncrypt(generated, context)
      }

      // Keyrings are required to not create new EncryptionMaterial instances, but
      // only append EncryptedDataKey.  Therefore the generated material has all
      // the data I want.
      return generated
    }

    async _onDecrypt (material: DecryptionMaterial<S>, encryptedDataKeys: EncryptedDataKey[], context?: EncryptionContext) {
      const children = this.children.slice()
      if (this.generator) children.unshift(this.generator)

      for (const keyring of children) {
        /* Check for early return (Postcondition): Do not attempt to decrypt once I have a valid key. */
        if (material.hasValidKey()) return material

        try {
          await keyring.onDecrypt(material, encryptedDataKeys, context)
        } catch (e) {
          // there should be some debug here?  or wrap?
          // Failures onDecrypt should not short-circuit the process
          // If the caller does not have access they may have access
          // through another Keyring.
        }
      }
      return material
    }
  }
  immutableClass(MultiKeyring)

  return MultiKeyring
}

interface KeyRingConstructible<S extends SupportedAlgorithmSuites> {
  new(): Keyring<S>
}

interface MultiKeyringInput<S extends SupportedAlgorithmSuites> {
  generator?: Keyring<S>
  children?: Keyring<S>[]
}

interface MultiKeyring<S extends SupportedAlgorithmSuites> extends Keyring<S> {
  generator?: Keyring<S>
  children: ReadonlyArray<Keyring<S>>
}

interface MultiKeyringConstructible<S extends SupportedAlgorithmSuites> {
  new(input: MultiKeyringInput<S>):MultiKeyring<S>
}
