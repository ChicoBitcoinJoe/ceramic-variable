import { TileDocument } from '@ceramicnetwork/stream-tile'
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

export interface PublicVariable {
  stream: TileDocument;
  controller: string;
  isControlled: boolean;
  get(): Promise<any>;
  set(value: any): Promise<any>;
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

export const loadFragment = async (Loader: TileLoader, streamId: string, controller: string, depth: number, commit: number, options?: CreateOpts) => {
  const metadata = getFragmentMetadata(streamId, controller, depth, commit)
  const fragment = await Loader.deterministic(metadata, options)
  if(Object.keys(fragment.content as any).length === 0) {
    throw new Error('Failed to create fragment or the data was lost.')
    // await fragment.update({ currentFragment: 0 })
  }
  return fragment
}

export const createNextLeaf = async (Loader: TileLoader, stream: TileDocument, currentFragment: number, startDepth: number, maxDepth: number, options: CreateOpts) => {
  const controller = stream.metadata.controllers[0]
  
  let fragmentPromises = []
  for(let i = startDepth; i < maxDepth; i++) {
    const fragment = i === startDepth ? currentFragment : 0
    const metadata = getFragmentMetadata(stream.id.toString(), controller, i, fragment)
    fragmentPromises.push(Loader.deterministic(metadata, options))
  }
  const fragments = await Promise.all(fragmentPromises)
  let updatePromises: Promise<any>[] = []
  fragments.forEach(fragment => {
    updatePromises.push(fragment.update({ currentFragment: 0 }))
  })
  return await Promise.all(updatePromises)
}

export const getValue_recursive = async (Loader: TileLoader, stream: TileDocument, fragment: TileDocument, controller: string, maxDepth: number, options?: CreateOpts): Promise<any> => {
  if(Object.keys(fragment.content).length == 0) return undefined

  const depth = Number(fragment.metadata.tags![1])
  if(depth + 1 === maxDepth){
    return fragment.content.value
  }
  else {
    const metadata = getFragmentMetadata(stream.id.toString(), controller, depth + 1, fragment.content.currentFragment)
    const nextFragment: any = await Loader.deterministic(metadata, options)
    return getValue_recursive(Loader, stream, nextFragment, controller, maxDepth, options)
  }
}

export const getLeaf_recursive = async (Loader: TileLoader, stream: TileDocument, fragment: TileDocument, history: any[], controller: string, maxDepth: number, options: CreateOpts): Promise<any> => {
  const depth = Number(fragment.metadata.tags![1])
  if(depth + 1 < maxDepth) {
    history.push(fragment)
    const nextFragment: any = await loadFragment(Loader, stream.id.toString(), controller, depth + 1, fragment.content.currentFragment, options)
    return await getLeaf_recursive(Loader, stream, nextFragment, history, controller, maxDepth, options)
  }
  else {
    return [ fragment, history ]
  }
}

export const getNextBranch = async (history: any[], maxFragments: number) => {
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

export const getVariableFromStream = (Loader: TileLoader, stream: TileDocument, options: CreateOpts, isControlled: boolean): PublicVariable => {
  const maxFragments = Number(stream.content.maxFragments)
  const maxDepth = Number(stream.content.maxDepth)
  const controller = stream.metadata.controllers[0]

  const get = async (): Promise<any> => {
    const metadata = getFragmentMetadata(stream.id.toString(), controller, 0, 0)
    const fragment: any = await Loader.deterministic(metadata)
    return await getValue_recursive(Loader, stream, fragment, controller, maxDepth, options)
  }

  const set = async (value: any): Promise<any> => {
    if(!isControlled) throw new Error('Current did does not control stream: ' + stream.id.toString())
    const head: any = await loadFragment(Loader, stream.id.toString(), controller, 0, 0, options)
    let [ leaf, history ] = await getLeaf_recursive(Loader, stream, head, [], controller, maxDepth, options)
    if(leaf.content.currentFragment + 1 >= maxFragments) {
      const branch = await getNextBranch(history, maxFragments)
      const depth = Number(branch.metadata.tags[1])
      const currentFragment = branch.content.currentFragment
      await createNextLeaf(Loader, stream, currentFragment, depth + 1, maxDepth, options)
      leaf = (await getLeaf_recursive(Loader, stream, branch, [], controller, maxDepth, options))[0]
    }
    return await leaf.update({ value })
  }

  return {
    stream,
    isControlled,
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
    const stream: any = await Loader.create(content, metadata, options.create)
    const isController = ceramic.did.id.toString() === options.variable.controller
    await createNextLeaf(Loader, stream, 0, 0, options.variable.maxDepth, options.create)
    return getVariableFromStream(Loader, stream, options.create, isController)
  }

  const deterministic = async (name: string, options: VariableOpts) => {
    const metadata = getDeterministicMetadata(name, options.variable.controller)
    let stream: any = await Loader.deterministic(metadata, options.create)
    if(Object.keys(stream.content as any).length === 0) {
      const content = { maxDepth: options.variable.maxDepth, maxFragments: options.variable.maxFragments }
      await stream.update(content)
      await createNextLeaf(Loader, stream, 0, 0, options.variable.maxDepth, options.create)      
    }
    const isController = ceramic.did.id.toString() === options.variable.controller
    return getVariableFromStream(Loader, stream, options.create, isController)
  }

  const load = async (streamId: string, options: VariableOpts) => {
    const stream: any = await Loader.load(streamId)
    const isController = ceramic.did.id.toString() === options.variable.controller
    return getVariableFromStream(Loader, stream, options.create, isController)
  }

  return {
    create,
    deterministic,
    load,
  }
}