import CeramicClient from '@ceramicnetwork/http-client'
import { randomBytes } from '@stablelib/random'
import { Ed25519Provider } from 'key-did-provider-ed25519'
import KeyDidResolver from 'key-did-resolver'
import { DID } from 'dids'

import CeramicVariable, { VariableOpts } from '../src/index';

const ceramic = new CeramicClient()
const Variable = CeramicVariable(ceramic)

jest.setTimeout(160000);

describe("test variable functionality", () => {
  
  const initialValue = "Hello World"
  const secondValue = "Two is more than one"
  const finalValue = "Goodbye everyone!"
  let options: VariableOpts = {
    create: {
      anchor: false,
      publish: false,
      sync: undefined,
      syncTimeoutSeconds: undefined,
      pin: false,
    },
    variable: {
      controller: "",
      maxDepth: 3,
      maxFragments: 3,
    }
  }

  beforeAll(async () => {
    const provider = new Ed25519Provider(randomBytes(32))
    const resolver = KeyDidResolver.getResolver()
    ceramic.did = new DID({ provider, resolver })
    await ceramic.did.authenticate()
    options.variable.controller = ceramic.did.id.toString()
  });

  it("create a standard public variable", async () => {
    const variable = await Variable.create('variable name', options)
    expect(await variable.get()).toEqual(undefined)
    await variable.set(initialValue)
    expect(await variable.get()).toEqual(initialValue)
    await variable.set(secondValue)
    expect(await variable.get()).toEqual(secondValue)
    await variable.set(finalValue)
    expect(await variable.get()).toEqual(finalValue)
  });
  
  it("create a deterministic public variable", async () => {
    const variable = await Variable.deterministic('variable name', options)
    expect(await variable.get()).toEqual(undefined)
    await variable.set(initialValue)
    expect(await variable.get()).toEqual(initialValue)
    await variable.set(secondValue)
    expect(await variable.get()).toEqual(secondValue)
    await variable.set(finalValue)
    expect(await variable.get()).toEqual(finalValue)
  });

});