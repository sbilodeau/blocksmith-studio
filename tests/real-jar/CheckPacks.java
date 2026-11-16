import java.io.PrintStream;
import java.nio.file.Path;
import java.util.Optional;
import net.minecraft.SharedConstants;
import net.minecraft.network.chat.Component;
import net.minecraft.server.Bootstrap;
import net.minecraft.server.packs.FilePackResources;
import net.minecraft.server.packs.PackLocationInfo;
import net.minecraft.server.packs.PackSelectionConfig;
import net.minecraft.server.packs.PackType;
import net.minecraft.server.packs.metadata.pack.PackMetadataSection;
import net.minecraft.server.packs.repository.Pack;
import net.minecraft.server.packs.repository.PackSource;

/**
 * Loads resource pack zips with the game's own code (the path used by the resource pack screen) and prints the
 * compatibility it computes. Compiled and run by tests/real-jar/pack-compat.test.ts against a real, unobfuscated
 * (26.1+) client jar on the classpath. Our code (MIT); nothing from the game is copied.
 *
 * Arguments: "resource:<zip>" (loaded as a resource pack) or "data:<zip>" (loaded as a data pack).
 * Output, one line each (tab-separated):
 *   GAME  <version id>  <resource major>.<minor>  <data major>.<minor>
 *   PACK  <zip file name>  <COMPATIBLE | TOO_OLD | TOO_NEW | UNKNOWN | REJECTED>  <declared range or error>
 */
public class CheckPacks {
  public static void main(String[] args) {
    // Bootstrap redirects System.out into the game's logger: keep the real stream for our output.
    PrintStream out = System.out;
    SharedConstants.tryDetectVersion();
    Bootstrap.bootStrap();
    var version = SharedConstants.getCurrentVersion();
    var resource = version.packVersion(PackType.CLIENT_RESOURCES);
    var data = version.packVersion(PackType.SERVER_DATA);
    out.println("GAME\t" + version.id() + "\t" + resource.major() + "." + resource.minor()
        + "\t" + data.major() + "." + data.minor());
    for (String arg : args) {
      int colon = arg.indexOf(':');
      PackType type = arg.substring(0, colon).equals("data") ? PackType.SERVER_DATA : PackType.CLIENT_RESOURCES;
      Path zip = Path.of(arg.substring(colon + 1));
      String name = zip.getFileName().toString();
      var info = new PackLocationInfo(
          "file/" + name, Component.literal(name), PackSource.DEFAULT, Optional.empty());
      var supplier = new FilePackResources.FileResourcesSupplier(zip);
      String range;
      try (var meta = supplier.openMetadata(info)) {
        PackMetadataSection section =
            meta.getMetadataSection(PackMetadataSection.forPackType(type));
        range = section == null ? "no pack section" : section.supportedFormats().toString();
      } catch (Exception e) {
        range = "error: " + e;
      }
      Pack pack = Pack.readMetaAndCreate(
          info, supplier, type, new PackSelectionConfig(false, Pack.Position.TOP, false));
      String verdict = pack == null ? "REJECTED" : pack.getCompatibility().name();
      out.println("PACK\t" + name + "\t" + verdict + "\t" + range);
    }
  }
}
