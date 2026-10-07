import { createExtractOrderInputNode as createSharedExtractOrderInputNode } from '../../chat/nodes/extractOrderInputNode.js';

export function createExtractOrderInputNode({ model, fetchAttachmentBufferFn } = {}) {
  return createSharedExtractOrderInputNode({ model, fetchAttachmentBufferFn });
}
