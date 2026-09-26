import os
import zipfile

dist_dir = 'dist'
zip_path = 'PluginZip.zip'

if os.path.exists(zip_path):
    os.remove(zip_path)

with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
    for root, dirs, files in os.walk(dist_dir):
        for file in files:
            full_path = os.path.join(root, file)
            rel_path = os.path.relpath(full_path, dist_dir)
            arcname = rel_path.replace('\\', '/')
            zipf.write(full_path, arcname)

print("Created clean PluginZip.zip successfully!")
