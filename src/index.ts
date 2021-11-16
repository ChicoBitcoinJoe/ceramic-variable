import { TileLoader } from '@glazed/tile-loader'
import { CreateOpts } from '@ceramicnetwork/common'

export interface VariableOpts {
  create: CreateOpts;
  variable: { 
    controller: string,
    maxDepth: number, 
    maxFragments: number,
  };
}

export const getDeterministicMetadata = (name: string, controller: string) => {
  return {
    controllers: [controller],
    family: 'CeramicPublicVariable',
    tags: [name]
  }
}

export const getFragmentMetadata = (streamId: string, controller: string, depth: number, fragment: number) => {
  return {
    controllers: [controller],
    family: 'CeramicPublicVariableFragment',
    tags: [streamId, depth.toString(), fragment.toString()]
  }
}

export const loadFragment = async (Loader: any, streamId: string, controller: string, depth: number, fragment: number, options?: CreateOpts) => {
  const metadata = getFragmentMetadata(streamId, controller, depth, fragment)
  const stream = await Loader.deterministic(metadata, options)
  if(Object.keys(stream.content).length === 0) 
    await stream.update({ currentFragment: 0 })
  return stream
}

export async function getVariableFromStream(Loader: any, stream: any, options: CreateOpts, controlled: boolean) {
  const maxFragments = Number(stream.content.maxFragments)
  const maxDepth = Number(stream.content.maxDepth)
  const controller = stream.metadata.controllers[0]

  const getValue_recursive = async (fragment: any): Promise<any> => {
    if(Object.keys(fragment.content).length == 0) return undefined

    const depth = Number(fragment.metadata.tags[1])
    if(depth === maxDepth){
      return fragment.content.value
    }
    else {
      const metadata = getFragmentMetadata(stream.id.toString(), controller, depth + 1, fragment.content.currentFragment)
      fragment = await Loader.deterministic(metadata, options)
      return getValue_recursive(fragment)
    }
  }

  const getTail_recursive = async (fragment: any, history: any[]): Promise<any> => {
    const depth = Number(fragment.metadata.tags[1])
    if(depth !== maxDepth) {
      history.push(fragment)
      const next = await loadFragment(Loader, stream.id.toString(), controller, depth + 1, fragment.content.currentFragment, options)
      return await getTail_recursive(next, history)
    }
    else {
      return [ fragment, history ]
    }
  }

  const getNextBranch = async (history: any[]) => {
    let branch = undefined
    for(let i = history.length-1; i >= 0; i--) {
      const fragment = history[i]
      const depth = Number(fragment.metadata.tags[1])
      const currentFragment = fragment.content.currentFragment
      const invalidFragment = currentFragment + 1 >= maxFragments
      if(!invalidFragment || depth === 0) {
        await fragment.update({ currentFragment: currentFragment + 1 })
        branch = fragment
        break
      }
    }
    return branch
  }

  const get = async (options?: CreateOpts) => {
    const metadata = getFragmentMetadata(stream.id.toString(), controller, 0, 0)
    const fragment = await Loader.deterministic(metadata, options)
    return await getValue_recursive(fragment)
  }

  const set = async (value: any): Promise<any> => {
    if(!controlled) throw new Error('Current did does not control stream: ' + stream.id.toString())
    
    const head = await loadFragment(Loader, stream.id.toString(), controller, 0, 0, options)
    let [ tail, history ] = await getTail_recursive(head, [])
    if(tail.allCommitIds.length+1 >= maxFragments) {
      const branch = await getNextBranch(history)
      tail = (await getTail_recursive(branch, []))[0]
    }
    return await tail.update({ value })
  }

  return {
    stream,
    controlled,
    controller,
    get,
    set
  }
}

export default function CeramicPublicVariable(ceramic: any) {

  const Loader = new TileLoader({ ceramic, cache: true })

  const create = async (name: string, options: VariableOpts) => {
    const content = { maxDepth: options.variable.maxDepth, maxFragments: options.variable.maxFragments }
    const metadata = getDeterministicMetadata(name, options.variable.controller)
    const stream = await Loader.create(content, metadata, options.create)
    const isController = ceramic.did.id.toString() === options.variable.controller
    return getVariableFromStream(Loader, stream, options.create, isController)
  }

  const deterministic = async (name: string, options: VariableOpts) => {
    const metadata = getDeterministicMetadata(name, options.variable.controller)
    let stream = await Loader.deterministic(metadata, options.create)
    const content: any = stream.content
    if(Object.keys(content).length === 0) {
      await stream.update(options.variable)
    }
    const isController = ceramic.did.id.toString() === options.variable.controller
    return getVariableFromStream(Loader, stream, options.create, isController)
  }

  const load = async (streamId: string, options: VariableOpts) => {
    const stream = await Loader.load(streamId)
    const isController = ceramic.did.id.toString() === options.variable.controller
    return getVariableFromStream(Loader, stream, options.create, isController)
  }

  return {
    create,
    deterministic,
    load,
  }
}