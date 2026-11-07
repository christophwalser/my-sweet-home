import com.eteks.sweethome3d.io.HomeFileRecorder;
import com.eteks.sweethome3d.model.Content;
import com.eteks.sweethome3d.model.Home;
import com.eteks.sweethome3d.model.HomePieceOfFurniture;
import com.eteks.sweethome3d.model.HomeTexture;
import com.eteks.sweethome3d.model.Room;
import com.eteks.sweethome3d.model.Wall;
import java.io.InputStream;

/**
 * Compatibility test: reads .sh3d files with the original Sweet Home 3D reader
 * and prints a summary. Every resource (model, icon, texture) is opened and
 * read completely.
 *
 * Usage: java -cp "SweetHome3D.jar;." ReadHome file1.sh3d [file2.sh3d ...]
 * Exit code 0 = all files readable, 1 = at least one error.
 */
public class ReadHome {
  public static void main(String[] args) {
    boolean ok = true;
    for (String file : args) {
      // Same configuration as the application itself (com.eteks.sweethome3d.SweetHome3D):
      // HomeFileRecorder(0, false, preferences, false, preferXmlEntry=true, true).
      // With preferXmlEntry=false, SH3D only reads the Java-serialized "Home" entry,
      // which My Sweet Home does not write.
      for (boolean preferXml : new boolean[] {true}) {
        try {
          Home home = new HomeFileRecorder(0, false, null, false, preferXml, true).readHome(file);
          int pieces = 0;
          long bytes = 0;
          for (HomePieceOfFurniture p : home.getFurniture()) {
            for (HomePieceOfFurniture q : expand(p)) {
              pieces++;
              bytes += readAll(q.getModel()) + readAll(q.getIcon());
              if (q.getTexture() != null) {
                bytes += readAll(q.getTexture().getImage());
              }
            }
          }
          for (Wall w : home.getWalls()) {
            bytes += texture(w.getLeftSideTexture()) + texture(w.getRightSideTexture());
          }
          for (Room r : home.getRooms()) {
            bytes += texture(r.getFloorTexture()) + texture(r.getCeilingTexture());
          }
          System.out.println("OK   " + file + " (preferXmlEntry=" + preferXml + ")"
              + " version=" + home.getVersion()
              + " levels=" + home.getLevels().size()
              + " walls=" + home.getWalls().size()
              + " rooms=" + home.getRooms().size()
              + " pieces=" + pieces
              + " dimensionLines=" + home.getDimensionLines().size()
              + " labels=" + home.getLabels().size()
              + " polylines=" + home.getPolylines().size()
              + " contentBytes=" + bytes);
        } catch (com.eteks.sweethome3d.model.DamagedHomeRecorderException e) {
          // XML was read, but resources are missing (e.g. example projects whose models
          // live in the SH3D catalog). Print the structure anyway.
          ok = false;
          Home home = e.getDamagedHome();
          System.out.println("MISSING " + file
              + " missingContents=" + e.getInvalidContent().size()
              + " version=" + home.getVersion()
              + " levels=" + home.getLevels().size()
              + " walls=" + home.getWalls().size()
              + " rooms=" + home.getRooms().size()
              + " pieces=" + home.getFurniture().size()
              + " dimensionLines=" + home.getDimensionLines().size()
              + " labels=" + home.getLabels().size()
              + " polylines=" + home.getPolylines().size());
        } catch (Throwable t) {
          ok = false;
          System.out.println("FAIL " + file + " (preferXmlEntry=" + preferXml + "): " + t);
          t.printStackTrace(System.out);
        }
      }
    }
    System.exit(ok ? 0 : 1);
  }

  private static java.util.List<HomePieceOfFurniture> expand(HomePieceOfFurniture p) {
    if (p instanceof com.eteks.sweethome3d.model.HomeFurnitureGroup) {
      return ((com.eteks.sweethome3d.model.HomeFurnitureGroup) p).getAllFurniture();
    }
    return java.util.Collections.singletonList(p);
  }

  private static long texture(HomeTexture t) throws Exception {
    return t == null ? 0 : readAll(t.getImage());
  }

  private static long readAll(Content c) throws Exception {
    if (c == null) {
      return 0;
    }
    long n = 0;
    try (InputStream in = c.openStream()) {
      byte[] buf = new byte[65536];
      for (int r; (r = in.read(buf)) != -1; ) {
        n += r;
      }
    }
    return n;
  }
}
