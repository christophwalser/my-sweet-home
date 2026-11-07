// Reads furniture or texture library files with the catalog classes of the
// original Sweet Home 3D and prints what they contain. Used to verify libraries
// written by My Sweet Home ("My furniture.sh3f", "My textures.sh3t").
//
// Usage: java -cp SweetHome3D.jar;<out> ReadCatalog <library.sh3f|library.sh3t>...

import com.eteks.sweethome3d.io.DefaultFurnitureCatalog;
import com.eteks.sweethome3d.io.DefaultTexturesCatalog;
import com.eteks.sweethome3d.model.CatalogPieceOfFurniture;
import com.eteks.sweethome3d.model.CatalogTexture;
import com.eteks.sweethome3d.model.FurnitureCategory;
import com.eteks.sweethome3d.model.TexturesCategory;
import java.io.File;
import java.net.URL;

public class ReadCatalog {
  public static void main(String[] args) throws Exception {
    int failures = 0;
    for (String arg : args) {
      File file = new File(arg);
      URL[] urls = {file.toURI().toURL()};
      int count = 0;
      StringBuilder items = new StringBuilder();
      if (arg.toLowerCase().endsWith(".sh3t")) {
        DefaultTexturesCatalog catalog = new DefaultTexturesCatalog(urls);
        for (TexturesCategory category : catalog.getCategories()) {
          for (CatalogTexture texture : category.getTextures()) {
            count++;
            items.append("\n  ").append(category.getName()).append(" / ").append(texture.getName())
                .append(" ").append(texture.getWidth()).append("x").append(texture.getHeight())
                .append(" id=").append(texture.getId())
                .append(" image=").append(texture.getImage() != null);
          }
        }
      } else {
        DefaultFurnitureCatalog catalog = new DefaultFurnitureCatalog(urls);
        for (FurnitureCategory category : catalog.getCategories()) {
          for (CatalogPieceOfFurniture piece : category.getFurniture()) {
            count++;
            items.append("\n  ").append(category.getName()).append(" / ").append(piece.getName())
                .append(" ").append(piece.getWidth()).append("x").append(piece.getDepth())
                .append("x").append(piece.getHeight())
                .append(" id=").append(piece.getId())
                .append(" model=").append(piece.getModel() != null)
                .append(" icon=").append(piece.getIcon() != null);
          }
        }
      }
      if (count == 0) {
        failures++;
        System.out.println("EMPTY " + arg);
      } else {
        System.out.println("OK   " + arg + " items=" + count + items);
      }
    }
    System.exit(failures == 0 ? 0 : 1);
  }
}
