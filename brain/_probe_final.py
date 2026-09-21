import ast
p = r'E:\Suras\brain\security_server.py'
src = open(p, encoding='utf-8').read()
tree = ast.parse(src)

imps = []
for n in ast.walk(tree):
    if isinstance(n, ast.ImportFrom):
        for a in n.names:
            imps.append((n.module, a.name, a.asname))

# count web_scout imports
wsc = [i for i in imps if i[0] == 'web_scout']
print('web_scout_imports =', len(wsc))

# find include_router calls + operand
incs = []
for n in ast.walk(tree):
    if isinstance(n, ast.Expr) and isinstance(n.value, ast.Call):
        fn = n.value.func
        if isinstance(fn, ast.Attribute) and fn.attr == 'include_router':
            args = n.value.args
            if args and isinstance(args[0], ast.Name):
                incs.append(args[0].id)
print('include_calls =', len(incs))
print('include_web_scout_router =', incs.count('web_scout_router'))
print('all_include_ids =', incs)
