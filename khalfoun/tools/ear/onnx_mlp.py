"""Writes the ear's classifier as a tiny ONNX file: (1,16,96) embeddings → (1,1) score."""
import numpy as np, onnx
from onnx import helper, TensorProto, numpy_helper

def export_mlp(layers, path):
    """layers: [(W (in,out), b (out,)), ...]; ReLU between, sigmoid at the end."""
    nodes = [helper.make_node('Flatten', ['x'], ['h0'], axis=1)]
    inits = []
    cur = 'h0'
    for i, (W, b) in enumerate(layers):
        inits += [numpy_helper.from_array(W.astype(np.float32), f'W{i}'), numpy_helper.from_array(b.astype(np.float32), f'b{i}')]
        out = f'g{i}'
        nodes.append(helper.make_node('Gemm', [cur, f'W{i}', f'b{i}'], [out]))
        if i < len(layers) - 1:
            nodes.append(helper.make_node('Relu', [out], [f'r{i}'])); cur = f'r{i}'
        else:
            cur = out
    nodes.append(helper.make_node('Sigmoid', [cur], ['score']))
    g = helper.make_graph(nodes, 'khalfoun_ear', [helper.make_tensor_value_info('x', TensorProto.FLOAT, [1, 16, 96])],
                          [helper.make_tensor_value_info('score', TensorProto.FLOAT, [1, 1])], inits)
    m = helper.make_model(g, opset_imports=[helper.make_opsetid('', 13)], producer_name='khalfoun')
    m.ir_version = 8
    onnx.checker.check_model(m)
    onnx.save(m, path)
