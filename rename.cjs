const fs = require('fs');
const path = require('path');

const dir = 'v:/Projects/Myraa';

function replaceInFile(filePath) {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
        if (filePath.includes('node_modules') || filePath.includes('.git')) return;
        const files = fs.readdirSync(filePath);
        for (const file of files) {
            replaceInFile(path.join(filePath, file));
        }
    } else {
        if (!['.js', '.ts', '.tsx', '.html', '.json', '.md'].includes(path.extname(filePath))) return;
        if (filePath.endsWith('package-lock.json')) return;

        let content = fs.readFileSync(filePath, 'utf8');
        let newContent = content.replace(/Myraa/g, 'Ananya');
        newContent = newContent.replace(/myraa/g, 'ananya');
        newContent = newContent.replace(/MYRAA/g, 'ANANYA');
        
        if (content !== newContent) {
            fs.writeFileSync(filePath, newContent, 'utf8');
            console.log(`Updated ${filePath}`);
        }
    }
}

function renameFiles(currentPath) {
    const stat = fs.statSync(currentPath);
    if (stat.isDirectory()) {
        if (currentPath.includes('node_modules') || currentPath.includes('.git')) return;
        const files = fs.readdirSync(currentPath);
        for (const file of files) {
            renameFiles(path.join(currentPath, file));
        }
    }
    
    const basename = path.basename(currentPath);
    if (basename.includes('Myraa') || basename.includes('myraa')) {
        const newBasename = basename.replace(/Myraa/g, 'Ananya').replace(/myraa/g, 'ananya');
        const newPath = path.join(path.dirname(currentPath), newBasename);
        fs.renameSync(currentPath, newPath);
        console.log(`Renamed ${currentPath} -> ${newPath}`);
    }
}

replaceInFile(dir);
renameFiles(dir);

console.log('Done replacing and renaming.');
